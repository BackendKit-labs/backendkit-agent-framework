import { AgentMCPServer, isAuthorized } from '../agent-server';

describe('isAuthorized', () => {
    it.each([
        [undefined, false],
        ['', false],
        ['Basic abc', false],
        ['Bearer wrong', false],
        ['Bearer secret-token-longer', false],
        ['Bearer secret-token', true],
    ])('header %p -> %p', (header, expected) => {
        expect(isAuthorized(header, 'secret-token')).toBe(expected);
    });
});

describe('AgentMCPServer HTTP auth', () => {
    const base = { name: 'test', tools: [], engineFactory: () => { throw new Error('unused'); } };

    it('refuses an empty authToken instead of starting with no authentication', async () => {
        const srv = new AgentMCPServer({ ...base, port: 0, authToken: '' } as any);
        await expect(srv.start()).rejects.toThrow(/authToken is empty/);
        expect(isAuthorized('Bearer ', '')).toBe(false);
    });

    it('refuses non-loopback host without authToken', async () => {
        const srv = new AgentMCPServer({ ...base, host: '0.0.0.0', port: 0 } as any);
        await expect(srv.start()).rejects.toThrow(/without authToken/);
    });

    it('returns 401 without token and passes auth with it', async () => {
        const srv = new AgentMCPServer({ ...base, port: 0, authToken: 'tok' } as any);
        await srv.start();
        const addr = (srv as any).httpServer.address();
        const url = `http://127.0.0.1:${addr.port}/other`;
        try {
            expect((await fetch(url)).status).toBe(401);
            expect((await fetch(url, { headers: { Authorization: 'Bearer tok' } })).status).toBe(404);
        } finally {
            await new Promise(r => (srv as any).httpServer.close(r));
        }
    });
});
