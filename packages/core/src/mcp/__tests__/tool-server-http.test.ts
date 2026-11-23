import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defineTool, z } from '../../tools/defineTool';
import { isBearerAuthorized, isLoopbackRequest, startToolServerHttp, type RunningToolServer } from '../tool-server-http';

const echo = defineTool({
    name: 'echo',
    description: 'Echo',
    readOnly: true,
    input: z.object({ text: z.string() }),
    execute: async ({ text }) => text,
});

const silent = { log: () => undefined };

describe('isBearerAuthorized', () => {
    it.each([
        [undefined, false],
        ['', false],
        ['Basic abc', false],
        ['Bearer wrong', false],
        ['Bearer secret-token-longer', false],
        ['Bearer secret-token', true],
        ['bearer secret-token', true],
    ])('header %p -> %p', (header, expected) => {
        expect(isBearerAuthorized(header, 'secret-token')).toBe(expected);
    });
});

describe('isLoopbackRequest', () => {
    it.each([
        ['127.0.0.1:3001', undefined, true],
        ['localhost:3001', 'http://localhost:5173', true],
        ['[::1]:3001', undefined, true],
        ['evil.example.com:3001', undefined, false],
        ['127.0.0.1:3001', 'https://evil.example.com', false],
        ['127.0.0.1:3001', 'null', false],
        [undefined, undefined, false],
    ])('host %p origin %p -> %p', (host, origin, expected) => {
        expect(isLoopbackRequest(host, origin)).toBe(expected);
    });
});

describe('startToolServerHttp', () => {
    let running: RunningToolServer;

    afterEach(async () => { await running?.close(); });

    it('refuses to listen off loopback without a token', async () => {
        await expect(startToolServerHttp({ name: 't', tools: [echo] }, { host: '0.0.0.0', port: 0, ...silent }))
            .rejects.toThrow(/without authToken/);
    });

    it('validates the tools before listening', async () => {
        await expect(startToolServerHttp({ name: 't', tools: [echo, echo] }, { port: 0, ...silent }))
            .rejects.toThrow(/duplicate tool name/);
    });

    it('guards: 401 without token, 404 off path, 405 for GET, 413 for a large body, 403 for a foreign host', async () => {
        running = await startToolServerHttp({ name: 't', tools: [echo], requireAgentIdentity: false }, { port: 0, authToken: 'tok', maxBodyBytes: 64, ...silent });
        const auth = { Authorization: 'Bearer tok' };

        expect((await fetch(running.url, { method: 'POST' })).status).toBe(401);
        expect((await fetch(`${running.url}/other`, { method: 'POST', headers: auth })).status).toBe(404);
        expect((await fetch(running.url, { method: 'GET', headers: auth })).status).toBe(405);
        expect((await fetch(running.url, { method: 'DELETE', headers: auth })).status).toBe(405);
        expect((await fetch(running.url, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pad: 'x'.repeat(100) }),
        })).status).toBe(413);
        expect((await fetch(running.url, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
            body: '{}',
        })).status).toBe(403);
    });

    it('serves a full MCP exchange, stateless, to an SDK client', async () => {
        running = await startToolServerHttp({ name: 't', version: '2.0.0', tools: [echo], requireAgentIdentity: false }, { port: 0, authToken: 'tok', ...silent });

        const connectClient = async () => {
            const client = new Client({ name: 'c', version: '0' });
            await client.connect(new StreamableHTTPClientTransport(new URL(running.url), {
                requestInit: { headers: { Authorization: 'Bearer tok' } },
            }));
            return client;
        };

        const a = await connectClient();
        try {
            expect(a.getServerVersion()).toMatchObject({ name: 't', version: '2.0.0' });
            const { tools } = await a.listTools();
            expect(tools.map(t => t.name)).toEqual(['echo']);
            expect(tools[0].annotations).toEqual({ readOnlyHint: true });

            const result = await a.callTool({ name: 'echo', arguments: { text: 'hola' } });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('hola');
        } finally {
            await a.close();
        }

        // A second client gets the same answers: nothing was kept from the first one.
        const b = await connectClient();
        try {
            const result = await b.callTool({ name: 'echo', arguments: { text: 'otra' } });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('otra');
        } finally {
            await b.close();
        }
    });

    it('reports the chosen port and url', async () => {
        running = await startToolServerHttp({ name: 't', tools: [echo], requireAgentIdentity: false }, { port: 0, path: '/tools', ...silent });
        expect(running.port).toBeGreaterThan(0);
        expect(running.url).toBe(`http://127.0.0.1:${running.port}/tools`);
    });
});
