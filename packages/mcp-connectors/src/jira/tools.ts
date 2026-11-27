import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchJson } from '../shared/http-client.js';

// ── Auth ──────────────────────────────────────────────────────────────────────

const HOST  = process.env.JIRA_HOST;   // e.g. mycompany.atlassian.net
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_TOKEN;  // Jira API token (not password)

/** An issue key (`PROJ-123`) or a numeric id: it goes into the URL path, so nothing else is accepted (audit C-13). */
const ISSUE_KEY = z.string().regex(/^(?:[A-Za-z][A-Za-z0-9_]*-\d+|\d+)$/, 'an issue key like PROJ-123, or a numeric id');
const BASE = `https://${HOST}/rest/api/3`;
const AUTH = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

async function jira<T>(method: string, path: string, body?: unknown): Promise<T> {
    return fetchJson<T>('Jira', `${BASE}${path}`, {
        method,
        headers: {
            'Authorization': `Basic ${AUTH}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

// Atlassian Document Format (ADF) → plain text
interface AdfNode { type: string; text?: string; content?: AdfNode[] }
function adfText(node: AdfNode | null | undefined): string {
    if (!node) return '';
    if (node.text) return node.text;
    if (!node.content) return '';
    const sep = node.type === 'paragraph' || node.type === 'doc' ? '\n' : '';
    return node.content.map(adfText).join(sep);
}
function adfDoc(text: string): unknown {
    return {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export function buildServer(): McpServer {
    const srv = new McpServer({ name: 'bk-mcp-jira', version: '0.1.0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    t(
        'jira_search',
        'Search Jira issues using JQL (Jira Query Language). Returns key, summary, status, and assignee.',
        {
            jql:   z.string().describe('JQL query (e.g. "project=PROJ AND status=\\"In Progress\\"")'),
            limit: z.number().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
        },
        async ({ jql, limit }: { jql: string; limit?: number }) => {
            const data = await jira<{
                issues: Array<{
                    key: string;
                    fields: {
                        summary: string;
                        status: { name: string };
                        assignee: { displayName: string } | null;
                        priority: { name: string } | null;
                    };
                }>;
            }>('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=${limit ?? 20}&fields=summary,status,assignee,priority`);
            const lines = data.issues.map(i => {
                const f = i.fields;
                return `${i.key}  [${f.status.name}]  ${f.priority?.name ?? '-'}  ${f.summary}  @${f.assignee?.displayName ?? 'unassigned'}`;
            });
            return {
                content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'No issues found.' }],
            };
        },
    );

    t(
        'jira_get_issue',
        'Get full details for a Jira issue including description and recent comments.',
        {
            key: ISSUE_KEY.describe('Jira issue key (e.g. PROJ-123)'),
        },
        async ({ key }: { key: string }) => {
            const data = await jira<{
                key: string;
                fields: {
                    summary: string;
                    status: { name: string };
                    assignee: { displayName: string } | null;
                    description: AdfNode | null;
                    comment: { comments: Array<{ author: { displayName: string }; body: AdfNode; created: string }> };
                };
            }>('GET', `/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,description,comment`);
            const f = data.fields;
            const desc = adfText(f.description);
            const comments = f.comment.comments.slice(-3).map(c =>
                `  [${c.author.displayName} · ${c.created.slice(0, 10)}]: ${adfText(c.body)}`,
            );
            const parts = [
                `${key}: ${f.summary}`,
                `Status: ${f.status.name}   Assignee: ${f.assignee?.displayName ?? 'unassigned'}`,
                desc ? `\nDescription:\n${desc}` : '',
                comments.length ? `\nComments (last ${comments.length}):\n${comments.join('\n')}` : '',
            ].filter(Boolean);
            return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
        },
    );

    t(
        'jira_create_issue',
        'Create a new Jira issue.',
        {
            project:     z.string().describe('Project key (e.g. PROJ)'),
            summary:     z.string().describe('Issue title/summary'),
            description: z.string().optional().describe('Issue description (plain text)'),
            issue_type:  z.string().optional().describe('Issue type (e.g. Task, Bug, Story). Default: Task'),
            priority:    z.string().optional().describe('Priority (e.g. High, Medium, Low)'),
        },
        async ({ project, summary, description, issue_type, priority }: {
            project: string; summary: string; description?: string;
            issue_type?: string; priority?: string;
        }) => {
            const fields: Record<string, unknown> = {
                project:   { key: project },
                summary,
                issuetype: { name: issue_type ?? 'Task' },
            };
            if (description) fields.description = adfDoc(description);
            if (priority)    fields.priority = { name: priority };
            const data = await jira<{ key: string; id: string }>('POST', '/issue', { fields });
            return { content: [{ type: 'text' as const, text: `Created ${data.key} (ID: ${data.id})` }] };
        },
    );

    t(
        'jira_add_comment',
        'Add a comment to a Jira issue.',
        {
            key:  ISSUE_KEY.describe('Issue key (e.g. PROJ-123)'),
            body: z.string().describe('Comment text'),
        },
        async ({ key, body }: { key: string; body: string }) => {
            await jira<unknown>('POST', `/issue/${encodeURIComponent(key)}/comment`, { body: adfDoc(body) });
            return { content: [{ type: 'text' as const, text: `Comment added to ${key}.` }] };
        },
    );

    t(
        'jira_transition',
        'Move a Jira issue to a new status (e.g. "In Progress", "Done").',
        {
            key:    ISSUE_KEY.describe('Issue key (e.g. PROJ-123)'),
            status: z.string().describe('Target status name (e.g. Done, In Progress, To Do)'),
        },
        async ({ key, status }: { key: string; status: string }) => {
            const { transitions } = await jira<{ transitions: Array<{ id: string; name: string }> }>(
                'GET', `/issue/${encodeURIComponent(key)}/transitions`,
            );
            const match = transitions.find(t => t.name.toLowerCase() === status.toLowerCase());
            if (!match) {
                const available = transitions.map(t => t.name).join(', ');
                throw new Error(`Status "${status}" not available for ${key}. Options: ${available}`);
            }
            await jira('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
            return { content: [{ type: 'text' as const, text: `${key} → "${match.name}"` }] };
        },
    );

    return srv;
}
