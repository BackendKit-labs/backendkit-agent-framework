import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface FetchCall { url: string; method: string; headers: Record<string, string>; body?: string }

/** Replace global fetch with a scripted fake. Each handler answers one call, in order. */
export function mockFetch(handlers: Array<(call: FetchCall) => { status?: number; json?: unknown; text?: string }>) {
    const calls: FetchCall[] = [];
    let i = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
        const call: FetchCall = {
            url: String(url),
            method: init.method ?? 'GET',
            headers: { ...(init.headers as Record<string, string> | undefined) },
            body: typeof init.body === 'string' ? init.body : init.body?.toString(),
        };
        calls.push(call);
        const h = handlers[i++];
        if (!h) throw new Error(`unexpected fetch #${i}: ${call.method} ${call.url}`);
        const r = h(call);
        const status = r.status ?? 200;
        return new Response(status === 204 ? null : (r.text ?? JSON.stringify(r.json ?? {})), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Connect an in-memory MCP client to a server built by a connector's buildServer(). */
export async function connect(server: McpServer) {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return {
        client,
        async call(name: string, args: Record<string, unknown> = {}) {
            const res = await client.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; isError?: boolean };
            return { text: res.content.map(c => c.text).join('\n'), isError: res.isError === true };
        },
        close: () => client.close(),
    };
}
