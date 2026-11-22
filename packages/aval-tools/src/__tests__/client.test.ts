import { createServer, type Server } from 'node:http';
import { avalKey, avalRequest, describeUnexpected } from '../client';

describe('avalRequest', () => {
    let server: Server;
    afterEach(async () => { await new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }); });

    const start = async (handler: Parameters<typeof createServer>[1]) => {
        server = createServer(handler);
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    };

    it('times out when the server sends headers and then stalls the body', async () => {
        const baseUrl = await start((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"decision":'); /* never ends */ });
        const t0 = Date.now();
        await expect(avalRequest({ baseUrl, timeoutMs: 300, maxAttempts: 1 }, 'k', 'GET', '/x')).rejects.toThrow(/timed out/);
        expect(Date.now() - t0).toBeLessThan(3000);
    });

    it('returns the body of a normal answer', async () => {
        const baseUrl = await start((_req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"no"}'); });
        const r = await avalRequest<{ error: string }>({ baseUrl }, 'k', 'GET', '/x');
        expect(r).toMatchObject({ status: 400, ok: false, body: { error: 'no' } });
    });
});

describe('avalKey / describeUnexpected', () => {
    it('treats an empty secret as no credential', () => {
        expect(avalKey({ baseUrl: 'x' }, { AVAL_KEY: '' })).toBeNull();
        expect(avalKey({ baseUrl: 'x' }, { AVAL_KEY: 'aval_sk_1' })).toBe('aval_sk_1');
    });
    it('bounds what an unexpected body can put in front of the model', () => {
        const text = describeUnexpected(200, { error: 'x'.repeat(5000) });
        expect(text.length).toBeLessThan(400);
        expect(describeUnexpected(200, {})).toContain('{}');
    });
});

describe('avalRequest — retries', () => {
    let server: Server;
    afterEach(async () => { await new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }); });

    it('retries a 5xx, then succeeds', async () => {
        let hits = 0;
        server = createServer((_req, res) => { hits++; res.writeHead(hits < 3 ? 503 : 200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const r = await avalRequest<{ ok: boolean }>({ baseUrl, maxAttempts: 3 }, 'k', 'GET', '/x');
        expect(hits).toBe(3);
        expect(r.body.ok).toBe(true);
    }, 15000);

    it('reports a readable message (not [object Object]) when every attempt fails', async () => {
        server = createServer((_req, res) => { res.writeHead(503); res.end(); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        await expect(avalRequest({ baseUrl, maxAttempts: 2 }, 'k', 'GET', '/x')).rejects.toThrow(/→ 503/);
    }, 15000);

    it('does not retry a 4xx: it is an answer', async () => {
        let hits = 0;
        server = createServer((_req, res) => { hits++; res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"decision":"denied"}'); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const r = await avalRequest({ baseUrl, maxAttempts: 3 }, 'k', 'POST', '/x', {});
        expect(hits).toBe(1);
        expect(r.status).toBe(400);
    });
});
