import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSign } from 'node:crypto';
import { z } from 'zod';
import { fetchJson } from '../shared/http-client.js';

// ── Auth ──────────────────────────────────────────────────────────────────────
//
// Two auth modes (checked in order):
//  1. GCAL_SERVICE_ACCOUNT_KEY — JSON content of a Google service account key.
//     Recommended for enterprise / long-running servers. The token is cached
//     and refreshed automatically every hour.
//  2. GCAL_ACCESS_TOKEN — OAuth2 access token (expires in ~1h).
//     Simplest for short-lived use; caller is responsible for refresh.

interface ServiceAccountKey {
    client_email: string;
    private_key:  string;
    token_uri?:   string;
}

let tokenCache: { token: string; expiresAt: number } | null = null;
// One exchange in flight at a time: when the cached token expires, every concurrent tool call used to start
// its own JWT exchange (a burst of identical requests to Google's token endpoint).
let tokenExchange: Promise<string> | null = null;

async function getToken(): Promise<string> {
    // Return valid cached token (60 s buffer before expiry)
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
        return tokenCache.token;
    }

    const saKeyJson = process.env.GCAL_SERVICE_ACCOUNT_KEY;
    if (saKeyJson) {
        const key: ServiceAccountKey = JSON.parse(saKeyJson);
        tokenExchange ??= exchangeServiceAccountToken(key)
            .then(token => {
                tokenCache = { token, expiresAt: Date.now() + 3_600_000 };
                return token;
            })
            // success or failure, the next caller starts fresh (a failed exchange is retried, not remembered)
            .finally(() => { tokenExchange = null; });
        return tokenExchange;
    }

    const staticToken = process.env.GCAL_ACCESS_TOKEN;
    if (staticToken) return staticToken;

    throw new Error('Set GCAL_SERVICE_ACCOUNT_KEY (recommended) or GCAL_ACCESS_TOKEN');
}

async function exchangeServiceAccountToken(key: ServiceAccountKey): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
    const payload = {
        iss:   key.client_email,
        scope: 'https://www.googleapis.com/auth/calendar',
        aud:   tokenUri,
        exp:   now + 3600,
        iat:   now,
    };

    const header    = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body      = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const toSign    = `${header}.${body}`;
    const sign      = createSign('RSA-SHA256');
    sign.update(toSign);
    const sig       = sign.sign(key.private_key.replace(/\\n/g, '\n'), 'base64url');
    const assertion = `${toSign}.${sig}`;

    const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });
    if (!res.ok) {
        throw new Error(`Service account token exchange failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json() as { access_token: string };
    return data.access_token;
}

async function gcal<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    const url   = path.startsWith('http') ? path : `https://www.googleapis.com/calendar/v3${path}`;
    return fetchJson<T>('Google Calendar', url, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    }, {
        // freeBusy is a read done with POST: repeating it is safe. Creating an event is not.
        idempotent: path === '/freeBusy' ? true : undefined,
    });
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export function buildServer(): McpServer {
    const srv = new McpServer({ name: 'bk-mcp-gcal', version: '0.1.0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    t(
        'calendar_list_calendars',
        'List all Google Calendars accessible to the authenticated account.',
        {},
        async () => {
            const data = await gcal<{
                items: Array<{ id: string; summary: string; primary?: boolean; accessRole: string }>;
            }>('GET', '/users/me/calendarList');
            const lines = data.items.map(c =>
                `${c.id}  "${c.summary}"${c.primary ? ' (primary)' : ''}  [${c.accessRole}]`,
            );
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        },
    );

    t(
        'calendar_list_events',
        'List upcoming events in a Google Calendar within a time range.',
        {
            calendar_id: z.string().optional().describe('Calendar ID (default: "primary")'),
            time_min:    z.string().optional().describe('Start of range, ISO 8601 (default: now)'),
            time_max:    z.string().optional().describe('End of range, ISO 8601 (default: 7 days from now)'),
            limit:       z.number().min(1).max(100).optional().describe('Max events (default 10, max 100)'),
        },
        async ({ calendar_id, time_min, time_max, limit }: {
            calendar_id?: string; time_min?: string; time_max?: string; limit?: number;
        }) => {
            const calId = encodeURIComponent(calendar_id ?? 'primary');
            const tMin  = time_min  ?? new Date().toISOString();
            const tMax  = time_max  ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
            const params = new URLSearchParams({
                timeMin: tMin, timeMax: tMax,
                maxResults: String(limit ?? 10),
                singleEvents: 'true', orderBy: 'startTime',
            });
            const data = await gcal<{
                items: Array<{
                    id: string; summary?: string;
                    start: { dateTime?: string; date?: string };
                    end:   { dateTime?: string; date?: string };
                    attendees?: Array<{ email: string; responseStatus: string }>;
                }>;
            }>('GET', `/calendars/${calId}/events?${params}`);
            const lines = data.items.map(e => {
                const start = e.start.dateTime?.slice(0, 16) ?? e.start.date ?? '?';
                const end   = e.end.dateTime?.slice(11, 16) ?? e.end.date ?? '?';
                const attendeeCount = e.attendees?.length ?? 0;
                return `[${start} – ${end}] ${e.summary ?? '(no title)'}${attendeeCount ? `  (${attendeeCount} attendees)` : ''}`;
            });
            return {
                content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'No events found in this range.' }],
            };
        },
    );

    t(
        'calendar_create_event',
        'Create a new event in a Google Calendar.',
        {
            summary:     z.string().describe('Event title'),
            start:       z.string().describe('Start time ISO 8601 (e.g. 2026-06-15T10:00:00)'),
            end:         z.string().describe('End time ISO 8601 (e.g. 2026-06-15T11:00:00)'),
            description: z.string().optional().describe('Event description'),
            attendees:   z.array(z.string()).optional().describe('List of attendee email addresses'),
            timezone:    z.string().optional().describe('IANA timezone (e.g. America/New_York). Default: UTC'),
            calendar_id: z.string().optional().describe('Calendar ID (default: "primary")'),
        },
        async ({ summary, start, end, description, attendees, timezone, calendar_id }: {
            summary: string; start: string; end: string;
            description?: string; attendees?: string[]; timezone?: string; calendar_id?: string;
        }) => {
            const tz  = timezone ?? 'UTC';
            const cal = encodeURIComponent(calendar_id ?? 'primary');
            const event: Record<string, unknown> = {
                summary,
                start: { dateTime: start, timeZone: tz },
                end:   { dateTime: end,   timeZone: tz },
            };
            if (description) event.description = description;
            if (attendees?.length) event.attendees = attendees.map(email => ({ email }));
            const data = await gcal<{ id: string; htmlLink: string }>(
                'POST', `/calendars/${cal}/events`, event,
            );
            return {
                content: [{ type: 'text' as const, text: `Event created: ${data.id}\n${data.htmlLink}` }],
            };
        },
    );

    t(
        'calendar_get_freebusy',
        'Check the free/busy availability for one or more users in a time range.',
        {
            emails:   z.array(z.string()).describe('List of email addresses to check'),
            time_min: z.string().describe('Start of range, ISO 8601'),
            time_max: z.string().describe('End of range, ISO 8601'),
        },
        async ({ emails, time_min, time_max }: { emails: string[]; time_min: string; time_max: string }) => {
            const data = await gcal<{
                calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
            }>('POST', '/freeBusy', {
                timeMin: time_min, timeMax: time_max,
                items:   emails.map(id => ({ id })),
            });
            const lines = emails.map(email => {
                const slots = data.calendars[email]?.busy ?? [];
                if (!slots.length) return `${email}: FREE all day`;
                const busyStr = slots.map(s =>
                    `  BUSY ${s.start.slice(11, 16)} – ${s.end.slice(11, 16)}`,
                ).join('\n');
                return `${email}:\n${busyStr}`;
            });
            return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
        },
    );

    return srv;
}
