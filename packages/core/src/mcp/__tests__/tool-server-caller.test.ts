import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defineTool, z } from '../../tools/defineTool';
import type { AuditEvent } from '../../governance/types';
import { selfAssertedIdentities } from '../../governance/agent-identity';
import { startToolServerHttp, type RunningToolServer } from '../tool-server-http';
import type { ToolCallInfo } from '../tool-server';

const silent = { log: () => undefined };
const lookup = defineTool({ name: 'lookup', description: 'reads', readOnly: true, input: z.object({}), execute: async () => 'ok' });

/** Personal tokens this server verifies; a stand-in for a real token check. */
const TOKENS: Record<string, string> = { 'tok-ana': 'ana', 'tok-luis': 'luis' };
const userOf = (call: ToolCallInfo) => {
    const token = call.headers?.['x-user-token'];
    const user = typeof token === 'string' ? TOKENS[token] : undefined;
    return user ? { userId: user } : undefined;
};

let running: RunningToolServer | undefined;
afterEach(async () => { await running?.close(); running = undefined; });

async function call(token?: string) {
    const client = new Client({ name: 'c', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(running!.url), {
        requestInit: { headers: { Authorization: 'Bearer srv', ...(token ? { 'x-user-token': token } : {}) } },
    }));
    try {
        const r = await client.callTool({ name: 'lookup', arguments: {} });
        return { isError: !!r.isError, text: (r.content as Array<{ text: string }>)[0].text };
    } finally {
        await client.close();
    }
}

describe('the tool server knows who calls', () => {
    it('acts for whoever made the call, from the identity function over the request headers', async () => {
        const events: AuditEvent[] = [];
        const seen: Array<ToolCallInfo['headers']> = [];
        running = await startToolServerHttp({
            name: 'ledger', tools: [lookup], requireAgentIdentity: false,
            identity: userOf,
            authorize: (c) => { seen.push(c.headers); return true; },
            auditSink: { write: (e) => { events.push(e); } },
        }, { port: 0, authToken: 'srv', ...silent });

        expect(await call('tok-ana')).toEqual({ isError: false, text: 'ok' });
        expect(await call('tok-luis')).toEqual({ isError: false, text: 'ok' });
        expect(events.map(e => e.principal.userId)).toEqual(['ana', 'luis']);
        expect(seen[0]?.['x-user-token']).toBe('tok-ana');   // authorize sees the caller too
    });

    it('with identity required, a caller the function cannot identify is denied', async () => {
        running = await startToolServerHttp({
            name: 'ledger', tools: [lookup], agentIdentity: selfAssertedIdentities(),
            identity: userOf,
        }, { port: 0, authToken: 'srv', ...silent });
        const unknown = await call('tok-nobody');
        expect(unknown.isError).toBe(true);
    });

    it('an identity function that throws denies the call, and its message stays in the server log', async () => {
        const logged: string[] = [];
        running = await startToolServerHttp({
            name: 'ledger', tools: [lookup], requireAgentIdentity: false,
            identity: () => { throw new Error('token service at 10.0.0.7 down'); },
            onInternalError: (err, info) => logged.push(`${info.where}:${(err as Error).message}`),
        }, { port: 0, authToken: 'srv', ...silent });
        const r = await call('tok-ana');
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/who the call is for could not be checked: internal error/);
        expect(r.text).not.toContain('10.0.0.7');
        expect(logged).toEqual(['identity:token service at 10.0.0.7 down']);
    });
});
