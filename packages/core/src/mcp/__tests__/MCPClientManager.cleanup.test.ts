import { MCPClientManager } from '../MCPClientManager';

// The SDK is replaced by fakes that record what is closed. A stdio transport has already spawned its
// subprocess by the time connect() runs, so "closed" here means "the child process was reaped".
const state = {
    connectFails: false,
    listFails: false,
    clientClosed: 0,
    transportClosed: 0,
    transports: 0,
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        onclose?: () => void;
        async connect() { if (state.connectFails) throw new Error('connect failed'); }
        async listTools() {
            if (state.listFails) throw new Error('list failed');
            return { tools: [{ name: 't', inputSchema: { type: 'object' } }] };
        }
        async close() { state.clientClosed++; }
    },
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: class {
        constructor() { state.transports++; }
        async close() { state.transportClosed++; }
    },
}));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: class { async close() { state.transportClosed++; } } }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class { async close() { state.transportClosed++; } } }));

const stdio = { name: 'fs', command: 'node', args: [] };

beforeEach(() => {
    Object.assign(state, { connectFails: false, listFails: false, clientClosed: 0, transportClosed: 0, transports: 0 });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('MCPClientManager — failed connections do not leave processes behind', () => {
    it('closes client and transport when connect() fails', async () => {
        state.connectFails = true;
        const m = new MCPClientManager([stdio]);
        await m.initialize();
        expect(m.isConnected('fs')).toBe(false);
        expect(state.clientClosed).toBe(1);
        expect(state.transportClosed).toBe(1);
    });

    it('closes them when the server connects but tool discovery fails', async () => {
        state.listFails = true;
        const m = new MCPClientManager([stdio]);
        await m.initialize();
        expect(m.isConnected('fs')).toBe(false);
        expect(state.clientClosed).toBe(1);
        expect(state.transportClosed).toBe(1);
    });

    it('every retry of a still-failing server reaps its own attempt (no growth per run)', async () => {
        state.connectFails = true;
        const m = new MCPClientManager([stdio]);
        await m.initialize();
        for (let i = 0; i < 3; i++) await m.reconnectFailed();
        expect(state.transports).toBe(4);
        expect(state.transportClosed).toBe(4);
    });

    it('a successful connection stays open and exposes its tools', async () => {
        const m = new MCPClientManager([stdio]);
        await m.initialize();
        expect(m.isConnected('fs')).toBe(true);
        expect(m.getTools().map(t => t.name)).toEqual(['mcp__fs__t']);
        expect(state.clientClosed).toBe(0);
        expect(state.transportClosed).toBe(0);
    });
});
