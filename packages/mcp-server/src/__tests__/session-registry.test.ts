import { SessionRegistry } from '../session-registry';
import { AgentMCPServer } from '../agent-server';

const session = () => ({ close: jest.fn().mockResolvedValue(undefined) });

describe('SessionRegistry', () => {
    let t = 0;
    const clock = () => t;
    beforeEach(() => { t = 1_000; });

    it('closes and forgets sessions idle past the ttl, keeps the active ones', async () => {
        const r = new SessionRegistry({ ttlMs: 1000, sweepEveryMs: 0, now: clock });
        const idle = session(), active = session();
        r.set('idle', idle); r.set('active', active);

        t += 800; r.get('active');   // activity refreshes it
        t += 400;                    // idle: 1200 ms since last seen; active: 400
        expect(await r.sweep()).toBe(1);

        expect(r.has('idle')).toBe(false);
        expect(idle.close).toHaveBeenCalledTimes(1);
        expect(r.has('active')).toBe(true);
        expect(active.close).not.toHaveBeenCalled();
    });

    it('a transport that fails to close is still forgotten and does not stop the sweep', async () => {
        const r = new SessionRegistry({ ttlMs: 10, sweepEveryMs: 0, now: clock });
        const bad = { close: jest.fn().mockRejectedValue(new Error('boom')) };
        const good = session();
        r.set('bad', bad); r.set('good', good);
        t += 100;
        expect(await r.sweep()).toBe(2);
        expect(r.size).toBe(0);
        expect(good.close).toHaveBeenCalled();
    });

    it('reports full at maxSessions and has room again after a delete', () => {
        const r = new SessionRegistry({ maxSessions: 2, sweepEveryMs: 0, now: clock });
        r.set('a', session()); expect(r.isFull()).toBe(false);
        r.set('b', session()); expect(r.isFull()).toBe(true);
        r.delete('a'); expect(r.isFull()).toBe(false);
    });

    it('closeAll closes everything and stops the sweep timer', async () => {
        const r = new SessionRegistry({ sweepEveryMs: 1000, now: clock });
        const a = session(), b = session();
        r.set('a', a); r.set('b', b);
        expect((r as unknown as { timer?: unknown }).timer).toBeDefined();
        await r.closeAll();
        expect(a.close).toHaveBeenCalled(); expect(b.close).toHaveBeenCalled();
        expect(r.size).toBe(0);
        expect((r as unknown as { timer?: unknown }).timer).toBeUndefined();
    });

    it('get on an unknown id is undefined and does not create anything', () => {
        const r = new SessionRegistry({ sweepEveryMs: 0 });
        expect(r.get('nope')).toBeUndefined();
        expect(r.size).toBe(0);
    });
});

describe('AgentMCPServer HTTP — session cap', () => {
    const init = {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    };
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

    it('answers 503 to a new session once maxSessions are open, and keeps serving the existing ones', async () => {
        const srv = new AgentMCPServer({ name: 'cap', tools: [], engineFactory: () => { throw new Error('unused'); }, port: 0, maxSessions: 1 } as never);
        await srv.start();
        const port = (srv as unknown as { httpServer: { address(): { port: number } } }).httpServer.address().port;
        const url = `http://127.0.0.1:${port}/mcp`;
        try {
            const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(init) });
            expect(first.status).toBe(200);
            const sid = first.headers.get('mcp-session-id');
            expect(sid).toBeTruthy();
            await first.text();

            const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...init, id: 2 }) });
            expect(second.status).toBe(503);
            expect(second.headers.get('retry-after')).toBe('60');
        } finally {
            await srv.stop();
        }
    });
});
