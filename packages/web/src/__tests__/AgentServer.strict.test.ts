/**
 * `strict` mode of AgentServer and `allowQueryToken: false` of JwtAuth, against a real server on a random port.
 */
import jwt from 'jsonwebtoken';
import WsClient from 'ws';
import type { AgentEngine } from '@backendkit-labs/agent-core';
import { AgentServer } from '../server/AgentServer';
import { JwtAuth } from '../auth/JwtAuth';

jest.setTimeout(15_000);

const SECRET = 'test-secret-at-least-32-chars-long!';
const token = () => jwt.sign({ sub: 'alice' }, SECRET);

const engineFactory = () => ({
    run: jest.fn().mockResolvedValue(undefined), abort: jest.fn(), use: jest.fn(), getTools: jest.fn().mockReturnValue([]),
}) as unknown as AgentEngine;

async function start(opts: Partial<ConstructorParameters<typeof AgentServer>[0]> = {}) {
    const server = new AgentServer({ port: 0, host: '127.0.0.1', engineFactory, ...opts });
    const address = await server.start();
    return { server, port: parseInt(address.split(':').pop()!, 10) };
}

/** Resolves with the first message and the negotiated subprotocol, or rejects with the failure of the upgrade. */
function connect(url: string, protocols?: string[]): Promise<{ first: Record<string, unknown>; protocol: string }> {
    return new Promise((resolve, reject) => {
        const ws = new WsClient(url, protocols);
        ws.once('message', (raw) => {
            resolve({ first: JSON.parse(String(raw)), protocol: ws.protocol });
            ws.close();
        });
        ws.once('unexpected-response', (_req, res) => { reject(new Error(`HTTP ${res.statusCode}`)); });
        ws.once('error', reject);
    });
}

describe('AgentServer strict', () => {
    it('refuses a non-loopback host without an auth hook', () => {
        expect(() => new AgentServer({ port: 0, host: '0.0.0.0', engineFactory, strict: true })).toThrow(/strict mode/);
        expect(() => new AgentServer({ port: 0, host: '0.0.0.0', engineFactory })).not.toThrow();
        expect(() => new AgentServer({
            port: 0, host: '0.0.0.0', engineFactory, strict: true, auth: new JwtAuth({ secret: SECRET }).hook(),
        })).not.toThrow();
    });

    it('allows no CORS origin by default and adds security headers', async () => {
        const { server, port } = await start({ strict: true });
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://evil.example' } });
            expect(res.headers.get('access-control-allow-origin')).toBeNull();
            expect(res.headers.get('x-content-type-options')).toBe('nosniff');
            expect(res.headers.get('x-frame-options')).toBe('DENY');
            expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        } finally { await server.stop(); }
    });

    it('allows the origins listed in `cors`', async () => {
        const { server, port } = await start({ strict: true, cors: ['https://app.example'] });
        try {
            const ok = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://app.example' } });
            const bad = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://evil.example' } });
            expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
            expect(bad.headers.get('access-control-allow-origin')).toBeNull();
        } finally { await server.stop(); }
    });

    it('without strict nothing changes: CORS is * and no extra headers', async () => {
        const { server, port } = await start();
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            expect(res.headers.get('access-control-allow-origin')).toBe('*');
            expect(res.headers.get('x-frame-options')).toBeNull();
        } finally { await server.stop(); }
    });
});

describe('JwtAuth over WebSocket', () => {
    it('allowQueryToken: false refuses ?token= and accepts the bearer subprotocol', async () => {
        const auth = new JwtAuth({ secret: SECRET, allowQueryToken: false }).hook();
        const { server, port } = await start({ auth });
        try {
            await expect(connect(`ws://127.0.0.1:${port}/chat?token=${token()}`)).rejects.toThrow(/401/);
            const { first, protocol } = await connect(`ws://127.0.0.1:${port}/chat`, ['bearer', token()]);
            expect(first.type).toBe('session_created');
            expect(protocol).toBe('bearer');
        } finally { await server.stop(); }
    });

    it('the default still accepts ?token= (backwards compatible)', async () => {
        const auth = new JwtAuth({ secret: SECRET }).hook();
        const { server, port } = await start({ auth });
        try {
            const { first } = await connect(`ws://127.0.0.1:${port}/chat?token=${token()}`);
            expect(first.type).toBe('session_created');
        } finally { await server.stop(); }
    });

    it('rejects a bad token in the subprotocol', async () => {
        const auth = new JwtAuth({ secret: SECRET, allowQueryToken: false }).hook();
        const { server, port } = await start({ auth });
        try {
            await expect(connect(`ws://127.0.0.1:${port}/chat`, ['bearer', 'not.a.jwt'])).rejects.toThrow(/401/);
        } finally { await server.stop(); }
    });
});
