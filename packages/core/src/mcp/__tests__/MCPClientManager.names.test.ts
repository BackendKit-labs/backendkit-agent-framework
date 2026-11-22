/** Audit 2026-11 (second pass): what a server names its tools, and how servers are named, cannot break the engine. */
import { MCPClientManager } from '../MCPClientManager';

const tools: Array<{ name: string; description?: string; inputSchema: unknown }> = [];

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        onclose?: () => void;
        async connect() { return undefined; }
        async listTools() { return { tools }; }
        async callTool() { return { content: [] }; }
        async close() { return undefined; }
    },
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class { async close() { return undefined; } } }));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: class { async close() { return undefined; } } }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class { async close() { return undefined; } } }));

const server = (name = 'crm') => new MCPClientManager([{ name, command: 'unused' } as never]);

describe('tool names from a server', () => {
    beforeEach(() => { tools.length = 0; jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => jest.restoreAllMocks());

    it('a tool with a name providers would refuse is left out, said, and the others stay', async () => {
        tools.push(
            { name: 'find_deal', inputSchema: { type: 'object' } },
            { name: 'bad name', inputSchema: { type: 'object' } },
            { name: 'with.dot', inputSchema: { type: 'object' } },
            { name: 'x'.repeat(80), inputSchema: { type: 'object' } },
            { name: 'create-deal', inputSchema: { type: 'object' } },
        );
        const mcp = server();
        await mcp.initialize();
        expect(mcp.getTools().map(t => t.name)).toEqual(['mcp__crm__find_deal', 'mcp__crm__create-deal']);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"bad name" is left out'));
        await mcp.disconnect();
    });

    it('the full name may not pass 64 characters', async () => {
        tools.push({ name: 'a'.repeat(60), inputSchema: { type: 'object' } });      // mcp__crm__ + 60 = 69
        const mcp = server();
        await mcp.initialize();
        expect(mcp.getTools()).toHaveLength(0);
        await mcp.disconnect();
    });

    it('a long description is cut, so a server cannot fill the prompt', async () => {
        tools.push({ name: 'find_deal', description: 'x'.repeat(10_000), inputSchema: { type: 'object' } });
        const mcp = server();
        await mcp.initialize();
        const d = mcp.getTools()[0]!.description;
        expect(d.length).toBeLessThan(2100);
        expect(d.endsWith('...')).toBe(true);
        await mcp.disconnect();
    });
});

describe('server names', () => {
    it('two names that become the same prefix are refused when the manager is built', () => {
        expect(() => new MCPClientManager([{ name: 'a b', command: 'x' } as never, { name: 'a_b', command: 'x' } as never])).toThrow(/share the tool prefix "mcp__a_b__"/);
    });
    it('distinct names are fine', () => {
        expect(() => new MCPClientManager([{ name: 'crm', command: 'x' } as never, { name: 'jira', command: 'x' } as never])).not.toThrow();
    });
});

describe('the 4xx check that decides the fallback to SSE', () => {
    const is4xx = (msg: string) => (server() as unknown as { isHTTP4xx(e: unknown): boolean }).isHTTP4xx(new Error(msg));
    it('a status in words counts', () => {
        expect(is4xx('Error POSTing to endpoint (HTTP 404): not found')).toBe(true);
        expect(is4xx('Non-200 status code (405)')).toBe(true);
    });
    it('digits that are not a status do not', () => {
        expect(is4xx('connect ECONNREFUSED 127.0.0.1:4000')).toBe(false);
        expect(is4xx('timed out after 1400ms')).toBe(false);
    });
});

describe('restarts are one at a time', () => {
    it('two at once connect the server once each, in order', async () => {
        tools.length = 0;
        tools.push({ name: 'find_deal', inputSchema: { type: 'object' } });
        const mcp = server();
        await mcp.initialize();
        const [a, b] = await Promise.all([mcp.restartAgent('crm'), mcp.restartAgent('crm')]);
        expect(a).toEqual(['crm']);
        expect(b).toEqual(['crm']);
        expect(mcp.getServerInfo()).toHaveLength(1);              // not two clients for one server
        await mcp.disconnect();
    });
});
