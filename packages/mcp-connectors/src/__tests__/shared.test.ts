import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchJson } from '../shared/http-client.js';
import { isBearerAuthorized, isLoopbackRequest, parseCliArgs, startHttp } from '../shared/server-runner.js';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, call: number) => void;

function upstream(handler: Handler): Promise<{ url: string; calls: () => number; close: () => Promise<void> }> {
    let calls = 0;
    const srv = http.createServer((req, res) => handler(req, res, ++calls));
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
        calls: () => calls,
        close: () => new Promise<void>(r => srv.close(() => r())),
    })));
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
};

describe('fetchJson', () => {
    it('returns parsed JSON and forwards method, headers and body', async () => {
        let seen: { method?: string; auth?: string; body?: string } = {};
        const up = await upstream((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                seen = { method: req.method, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() };
                json(res, 200, { ok: true });
            });
        });
        try {
            const out = await fetchJson<{ ok: boolean }>('Svc', `${up.url}/x`, {
                method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{"a":1}',
            });
            expect(out).toEqual({ ok: true });
            expect(seen).toEqual({ method: 'POST', auth: 'Bearer t', body: '{"a":1}' });
        } finally { await up.close(); }
    });

    it('204 resolves to undefined', async () => {
        const up = await upstream((_q, res) => { res.writeHead(204); res.end(); });
        try {
            expect(await fetchJson('Svc', up.url, {})).toBeUndefined();
        } finally { await up.close(); }
    });

    it.each([400, 404, 401, 403])('%i is not retried and the error names service, method, status and body', async (status) => {
        const up = await upstream((_q, res) => { res.writeHead(status); res.end('nope-body'); });
        try {
            await expect(fetchJson('Jira', `${up.url}/rest?secret=1`, {})).rejects.toThrow(
                new RegExp(`Jira GET .*/rest → ${status}: nope-body`),
            );
            expect(up.calls()).toBe(1);
        } finally { await up.close(); }
    });

    it('the error message does not leak the query string', async () => {
        const up = await upstream((_q, res) => { res.writeHead(404); res.end('x'); });
        try {
            await expect(fetchJson('Svc', `${up.url}/p?token=SECRET`, {})).rejects.not.toThrow(/SECRET/);
        } finally { await up.close(); }
    });

    it.each([500, 503, 429])('retries %i and succeeds on a later attempt', async (status) => {
        const up = await upstream((_q, res, call) => (call < 2 ? (res.writeHead(status), res.end('busy')) : json(res, 200, { n: call })));
        try {
            expect(await fetchJson('Svc', up.url, {})).toEqual({ n: 2 });
            expect(up.calls()).toBe(2);
        } finally { await up.close(); }
    }, 15_000);

    it('gives up after maxAttempts on persistent 5xx', async () => {
        const up = await upstream((_q, res) => { res.writeHead(502); res.end('bad gateway'); });
        try {
            await expect(fetchJson('Svc', up.url, {}, { maxAttempts: 2 })).rejects.toThrow(/502: bad gateway/);
            expect(up.calls()).toBe(2);
        } finally { await up.close(); }
    }, 15_000);

    describe('retries only what is safe to repeat', () => {
        const post = { method: 'POST', body: '{}' };

        it.each([500, 502, 503])('does not repeat a POST after a %i: the first attempt may have been applied', async (status) => {
            const up = await upstream((_q, res, call) => (call < 2 ? (res.writeHead(status), res.end('fail')) : json(res, 200, { n: call })));
            try {
                await expect(fetchJson('Svc', up.url, post)).rejects.toThrow(new RegExp(`${status}: fail`));
                expect(up.calls()).toBe(1);
            } finally { await up.close(); }
        });

        it('does not repeat a POST after a dropped connection or a timeout', async () => {
            const dropped = await upstream((req, _res, call) => { if (call === 1) req.socket.destroy(); });
            try {
                await expect(fetchJson('Svc', dropped.url, post, { maxAttempts: 3 })).rejects.toThrow(/network error/);
                expect(dropped.calls()).toBe(1);
            } finally { await dropped.close(); }

            const hung = await upstream(() => { /* never answers */ });
            try {
                await expect(fetchJson('Svc', hung.url, post, { timeoutMs: 100, maxAttempts: 3 })).rejects.toThrow(/timed out/);
                expect(hung.calls()).toBe(1);
            } finally { await hung.close(); }
        }, 15_000);

        it('repeats a POST after a 429: the request was refused, not processed', async () => {
            const up = await upstream((_q, res, call) => (call < 2 ? (res.writeHead(429), res.end('slow down')) : json(res, 200, { n: call })));
            try {
                expect(await fetchJson('Svc', up.url, post)).toEqual({ n: 2 });
                expect(up.calls()).toBe(2);
            } finally { await up.close(); }
        }, 15_000);

        it('repeats a POST that the caller marks as idempotent (a JSON-RPC read)', async () => {
            const up = await upstream((_q, res, call) => (call < 2 ? (res.writeHead(503), res.end('busy')) : json(res, 200, { n: call })));
            try {
                expect(await fetchJson('Svc', up.url, post, { idempotent: true })).toEqual({ n: 2 });
                expect(up.calls()).toBe(2);
            } finally { await up.close(); }
        }, 15_000);

        it.each(['PUT', 'DELETE'])('still repeats %s, which is idempotent by definition', async (method) => {
            const up = await upstream((_q, res, call) => (call < 2 ? (res.writeHead(503), res.end('busy')) : json(res, 200, { n: call })));
            try {
                expect(await fetchJson('Svc', up.url, { method })).toEqual({ n: 2 });
                expect(up.calls()).toBe(2);
            } finally { await up.close(); }
        }, 15_000);

        it('a GET the caller marks as non-idempotent is not repeated', async () => {
            const up = await upstream((_q, res) => { res.writeHead(503); res.end('busy'); });
            try {
                await expect(fetchJson('Svc', up.url, {}, { idempotent: false })).rejects.toThrow(/503/);
                expect(up.calls()).toBe(1);
            } finally { await up.close(); }
        });
    });

    it('times out a hung upstream with a clear message', async () => {
        const up = await upstream(() => { /* never answers */ });
        try {
            await expect(fetchJson('Svc', up.url, {}, { timeoutMs: 100, maxAttempts: 1 })).rejects.toThrow(/timed out after 100ms/);
        } finally { await up.close(); }
    }, 15_000);

    it('reports a network error when the host is unreachable', async () => {
        await expect(fetchJson('Svc', 'http://127.0.0.1:1', {}, { maxAttempts: 1 })).rejects.toThrow(/network error/);
    });
});

describe('parseCliArgs', () => {
    it('defaults to stdio mode on 3001', () => {
        expect(parseCliArgs([])).toEqual({ httpMode: false, port: 3001 });
    });
    it('--http alone keeps the default port (was NaN)', () => {
        expect(parseCliArgs(['--http'])).toEqual({ httpMode: true, port: 3001 });
    });
    it('supports --port=N and --port N', () => {
        expect(parseCliArgs(['--http', '--port=4000']).port).toBe(4000);
        expect(parseCliArgs(['--http', '--port', '4001']).port).toBe(4001);
    });
    it.each([['abc'], ['70000'], ['-1'], ['']])('rejects invalid port %p', (v) => {
        expect(() => parseCliArgs(['--http', `--port=${v}`])).toThrow(/Invalid --port/);
    });
});

describe('request guards', () => {
    it.each([
        ['127.0.0.1:3001', undefined, true],
        ['localhost:3001', undefined, true],
        ['[::1]:3001', undefined, true],
        ['127.0.0.1:3001', 'http://localhost:5173', true],
        ['evil.example.com', undefined, false],
        ['127.0.0.1.evil.com:3001', undefined, false],
        [undefined, undefined, false],
        ['127.0.0.1:3001', 'https://evil.example.com', false],
        ['127.0.0.1:3001', 'not a url', false],
    ])('host=%p origin=%p -> %p', (host, origin, expected) => {
        expect(isLoopbackRequest(host, origin)).toBe(expected);
    });

    it('isBearerAuthorized is exact', () => {
        expect(isBearerAuthorized('Bearer tok', 'tok')).toBe(true);
        for (const h of [undefined, '', 'tok', 'Bearer', 'Bearer toK', 'Bearer tok2', 'Basic tok']) {
            expect(isBearerAuthorized(h, 'tok')).toBe(false);
        }
    });
});

describe('startHttp', () => {
    const build = () => new McpServer({ name: 'test', version: '0' });
    const open: http.Server[] = [];
    afterEach(async () => { await Promise.all(open.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); });

    const start = async (token?: string) => {
        const srv = await startHttp(build, 0, 'test', token);
        open.push(srv);
        return (srv.address() as AddressInfo).port;
    };

    // fetch() forbids overriding Host/Origin, so use http.request for the guard cases.
    const request = (port: number, headers: http.OutgoingHttpHeaders, path = '/mcp') =>
        new Promise<number>((resolve, reject) => {
            const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, res => { res.resume(); resolve(res.statusCode!); });
            r.on('error', reject);
            r.end();
        });

    it('rejects a foreign Host (DNS rebinding) and a foreign Origin with 403', async () => {
        const port = await start();
        expect(await request(port, { Host: 'evil.example.com' })).toBe(403);
        expect(await request(port, { Origin: 'https://evil.example.com' })).toBe(403);
    });

    it('serves loopback requests: wrong path 404, GET without session 400', async () => {
        const port = await start();
        expect(await request(port, {}, '/other')).toBe(404);
        expect(await request(port, {})).toBe(400);
    });

    it('with a token configured: 401 without it, passes with it', async () => {
        const port = await start('s3cret');
        expect(await request(port, {})).toBe(401);
        expect(await request(port, { Authorization: 'Bearer wrong' })).toBe(401);
        expect(await request(port, { Authorization: 'Bearer s3cret' })).toBe(400);
    });
});
