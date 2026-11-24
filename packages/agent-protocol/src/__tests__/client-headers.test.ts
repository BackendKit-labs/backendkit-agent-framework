/**
 * The client can carry what the gate of a server reads (a personal token): on every call, or on one call. It cannot replace what is the client's own
 * (the key of the protocol, the framing of the body). A plain HTTP server records the headers each request arrived with.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AgentClient } from '../index';

type Seen = { path: string; headers: Record<string, string | string[] | undefined> };
let http: Server;
let url: string;
let seen: Seen[];

beforeEach(async () => {
    seen = [];
    http = createServer((req, res) => {
        seen.push({ path: req.url ?? '', headers: req.headers });
        res.setHeader('Content-Type', 'application/json');
        const data = (req.url ?? '').includes('/flows/') ? { flowRunId: 'r1' } : { status: 'done', output: 'ok' };
        res.end(JSON.stringify({ ok: true, data }));
    });
    await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>(r => http.close(() => r())));

describe('headers of the client', () => {
    it('a header of the client travels on every call, next to the key of the protocol', async () => {
        const client = new AgentClient({ url, apiKey: 'k', headers: { 'x-user-token': 'tok-1' } });
        await client.run('work', {});
        await client.run('work', {});
        expect(seen).toHaveLength(2);
        for (const r of seen) expect(r.headers).toMatchObject({ authorization: 'Bearer k', 'x-user-token': 'tok-1', 'content-type': 'application/json' });
    });

    it('a header of one call replaces the one of the client for that call only', async () => {
        const client = new AgentClient({ url, headers: { 'x-user-token': 'client-level' } });
        await client.run('work', {}, { headers: { 'x-user-token': 'carlos' } });
        await client.run('work', {});
        expect(seen[0]!.headers['x-user-token']).toBe('carlos');
        expect(seen[1]!.headers['x-user-token']).toBe('client-level');       // it did not leak into the next call
    });

    it('runAndWait carries the headers of its call', async () => {
        await new AgentClient({ url }).runAndWait('work', {}, { headers: { 'x-user-token': 'ana' } });
        expect(seen[0]!.headers['x-user-token']).toBe('ana');
    });

    it('starting a flow carries them too', async () => {
        await new AgentClient({ url, headers: { 'x-a': '1' } }).startFlow('f', {}, undefined, { 'x-user-token': 'laura' });
        expect(seen[0]!.path).toContain('/flows/f/runs');
        expect(seen[0]!.headers).toMatchObject({ 'x-a': '1', 'x-user-token': 'laura' });
    });

    it('what is the client\'s own cannot be replaced: Authorization and Content-Type, in any case, are refused', async () => {
        expect(() => new AgentClient({ url, apiKey: 'k', headers: { Authorization: 'Bearer other' } })).toThrow(/Authorization.*apiKey/);
        const client = new AgentClient({ url, apiKey: 'k' });
        await expect(client.run('work', {}, { headers: { 'content-type': 'text/plain' } })).rejects.toThrow(/content-type/);
        await expect(client.startFlow('f', {}, undefined, { AUTHORIZATION: 'x' })).rejects.toThrow(/AUTHORIZATION/);
        expect(seen).toHaveLength(0);
    });
});
