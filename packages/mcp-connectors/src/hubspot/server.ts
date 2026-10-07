#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';
import { fetchJson } from '../shared/http-client.js';

// ── Auth ──────────────────────────────────────────────────────────────────────

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) {
    process.stderr.write('[bk-mcp-hubspot] HUBSPOT_TOKEN env var is required (HubSpot Private App token).\n');
    process.exit(1);
}

const BASE = 'https://api.hubapi.com';

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
    return fetchJson<T>('HubSpot', `${BASE}${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function buildServer(): McpServer {
    const srv = new McpServer({ name: 'bk-mcp-hubspot', version: '0.1.0' });
    // Cast to any to prevent TypeScript from attempting deep Zod schema inference
    // during declaration emit — the MCP SDK validates schemas at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    t(
        'crm_search_contacts',
        'Search HubSpot CRM contacts by name, email, or company.',
        {
            query: z.string().describe('Search term — name, email, or company'),
            limit: z.number().min(1).max(100).optional().describe('Max results (default 10, max 100)'),
        },
        async ({ query, limit }: { query: string; limit?: number }) => {
            const data = await hs<{
                results: Array<{ id: string; properties: Record<string, string> }>;
            }>('POST', '/crm/v3/objects/contacts/search', {
                query,
                limit: limit ?? 10,
                properties: ['firstname', 'lastname', 'email', 'phone', 'company'],
            });
            const lines = data.results.map(c => {
                const p = c.properties;
                return `ID:${c.id}  ${p.firstname ?? ''} ${p.lastname ?? ''}  <${p.email ?? ''}>  ${p.company ?? ''}  ${p.phone ?? ''}`.trim();
            });
            return {
                content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'No contacts found.' }],
            };
        },
    );

    t(
        'crm_get_contact',
        'Get full property details for a HubSpot contact by ID.',
        {
            id: z.string().describe('HubSpot contact ID'),
        },
        async ({ id }: { id: string }) => {
            const props = 'firstname,lastname,email,phone,company,jobtitle,lifecyclestage,createdate,lastmodifieddate';
            const data = await hs<{ id: string; properties: Record<string, string> }>(
                'GET', `/crm/v3/objects/contacts/${id}?properties=${props}`,
            );
            const lines = Object.entries(data.properties)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}: ${v}`);
            return {
                content: [{ type: 'text' as const, text: `Contact ${id}\n${lines.join('\n')}` }],
            };
        },
    );

    t(
        'crm_create_contact',
        'Create a new contact in HubSpot CRM.',
        {
            email:     z.string().describe('Email address (required)'),
            firstname: z.string().optional(),
            lastname:  z.string().optional(),
            phone:     z.string().optional(),
            company:   z.string().optional(),
            jobtitle:  z.string().optional(),
        },
        async (props: { email: string; firstname?: string; lastname?: string; phone?: string; company?: string; jobtitle?: string }) => {
            const properties: Record<string, string> = {};
            for (const [k, v] of Object.entries(props)) {
                if (v) properties[k] = v;
            }
            const data = await hs<{ id: string }>('POST', '/crm/v3/objects/contacts', { properties });
            return { content: [{ type: 'text' as const, text: `Created contact ID: ${data.id}` }] };
        },
    );

    t(
        'crm_search_deals',
        'Search HubSpot CRM deals by name and/or deal stage.',
        {
            query: z.string().optional().describe('Deal name search term'),
            stage: z.string().optional().describe('Deal stage key (e.g. appointmentscheduled, closedwon)'),
            limit: z.number().min(1).max(100).optional().describe('Max results (default 10, max 100)'),
        },
        async ({ query, stage, limit }: { query?: string; stage?: string; limit?: number }) => {
            const body: Record<string, unknown> = {
                limit: limit ?? 10,
                properties: ['dealname', 'dealstage', 'amount', 'closedate'],
            };
            if (query) body.query = query;
            if (stage) {
                body.filterGroups = [{
                    filters: [{ propertyName: 'dealstage', operator: 'EQ', value: stage }],
                }];
            }
            const data = await hs<{
                results: Array<{ id: string; properties: Record<string, string> }>;
            }>('POST', '/crm/v3/objects/deals/search', body);
            const lines = data.results.map(d => {
                const p = d.properties;
                return `ID:${d.id}  ${p.dealname ?? ''}  stage:${p.dealstage ?? ''}  $${p.amount ?? '0'}  close:${p.closedate?.slice(0, 10) ?? '-'}`;
            });
            return {
                content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'No deals found.' }],
            };
        },
    );

    t(
        'crm_create_note',
        'Log an activity note in HubSpot, optionally associated with a contact or deal.',
        {
            body:       z.string().describe('Note text content'),
            contact_id: z.string().optional().describe('HubSpot contact ID to associate'),
            deal_id:    z.string().optional().describe('HubSpot deal ID to associate'),
        },
        async ({ body, contact_id, deal_id }: { body: string; contact_id?: string; deal_id?: string }) => {
            type Assoc = { to: { id: string }; types: Array<{ associationCategory: string; associationTypeId: number }> };
            const associations: Assoc[] = [];
            if (contact_id) {
                associations.push({ to: { id: contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] });
            }
            if (deal_id) {
                associations.push({ to: { id: deal_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] });
            }
            const data = await hs<{ id: string }>('POST', '/crm/v3/objects/notes', {
                properties: { hs_note_body: body, hs_timestamp: Date.now().toString() },
                associations,
            });
            return { content: [{ type: 'text' as const, text: `Created note ID: ${data.id}` }] };
        },
    );

    return srv;
}

// ── Start ─────────────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'bk-mcp-hubspot' }).catch(err => {
    process.stderr.write(`[bk-mcp-hubspot] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
