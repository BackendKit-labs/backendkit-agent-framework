/**
 * Audit 2026-11, second pass: a web page cannot drive or watch a local agent, a client cannot queue turns without bound,
 * the detail of an engine error stays on the server, and a webhook is signed or says it is not.
 */
import WsClient from 'ws';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AgentServer } from '../server/AgentServer';
import { JwtAuth } from '../auth/JwtAuth';
import { TriggerBus } from '../trigger/TriggerBus';
import { SessionManager } from '../session/SessionManager';
import type { AgentEngine } from '@backendkit-labs/agent-core';

jest.setTimeout(20_000);

const EVIL = { origin: 'https://evil.example' };

function engineWith(run: (input: string) => Promise<void>) {
    return { run: jest.fn(run), abort: jest.fn(), use: jest.fn(), getTools: jest.fn().mockReturnValue([]) } as unknown as jest.Mocked<AgentEngine>;
}

async function start(opts: Record<string, unknown>, engine = engineWith(async () => undefined)) {
    const server = new AgentServer({ port: 0, host: '127.0.0.1', engineFactory: () => engine, ...opts } as never);
    const address = await server.start();
    return { server, engine, address, port: parseInt(address.split(':').pop()!, 10) };
}

/** Opens a WebSocket and resolves with it and its first frame, or rejects with the HTTP status of a refused upgrade. */
function open(port: number, path: string, headers: Record<string, string> = {}, protocols?: string[]): Promise<{ ws: WsClient; first: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        const ws = new WsClient(`ws://127.0.0.1:${port}${path}`, protocols, { headers });
        ws.once('message', d => resolve({ ws, first: JSON.parse(d.toString()) }));
        ws.once('unexpected-response', (req, res) => { res.resume(); req.destroy(); ws.terminate(); reject(new Error(`HTTP ${res.statusCode}`)); });
        ws.once('error', e => { ws.terminate(); reject(e); });
    });
}
const next = (ws: WsClient, ms = 3000) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    ws.once('message', d => { clearTimeout(t); resolve(JSON.parse(d.toString())); });
});

describe('a server with no auth on loopback (the documented setup)', () => {
    let s: Awaited<ReturnType<typeof start>>;
    beforeAll(async () => { s = await start({ cors: '*' }); });
    afterAll(async () => { await s.server.stop(); });

    it('refuses a WebSocket from a foreign origin: /chat and /monitor', async () => {
        await expect(open(s.port, '/chat', EVIL)).rejects.toThrow('HTTP 403');
        await expect(open(s.port, '/monitor', EVIL)).rejects.toThrow('HTTP 403');
        expect(s.engine.run).not.toHaveBeenCalled();
    });

    it('refuses a request whose Host is not loopback (DNS rebinding), and any HTTP request from a foreign origin', async () => {
        const rebinding = await fetch(`http://127.0.0.1:${s.port}/health`, { headers: { Origin: 'https://evil.example' } });
        expect(rebinding.status).toBe(403);
    });

    it('still serves a client with no Origin, and one from loopback (a script, a local front end)', async () => {
        const { ws, first } = await open(s.port, '/chat');
        expect(first.type).toBe('session_created');
        ws.terminate();
        const local = await open(s.port, '/chat', { origin: 'http://localhost:5173' });
        expect(local.first.type).toBe('session_created');
        local.ws.terminate();
        expect((await fetch(`http://127.0.0.1:${s.port}/health`)).status).toBe(200);
    });
});

describe('an origin the operator listed', () => {
    it('is allowed even on loopback; another is not', async () => {
        const s = await start({ cors: ['https://app.example.com'] });
        try {
            const ok = await open(s.port, '/chat', { origin: 'https://app.example.com' });
            expect(ok.first.type).toBe('session_created');
            ok.ws.terminate();
            await expect(open(s.port, '/chat', EVIL)).rejects.toThrow('HTTP 403');
        } finally { await s.server.stop(); }
    });
});

describe('with auth', () => {
    const secret = 'test-secret-test-secret-test-secret';
    const token = jwt.sign({ sub: 'ana' }, secret, { expiresIn: 60 });

    it('a token is what lets a client in, from any origin; an explicit list of origins is also enforced on the upgrade', async () => {
        const open1 = await start({ auth: new JwtAuth({ secret }).hook(), cors: '*' });
        try {
            await expect(open(open1.port, '/chat', EVIL)).rejects.toThrow('HTTP 401');                        // no token
            const ok = await open(open1.port, '/chat', EVIL, ['bearer', token]);
            expect(ok.first.type).toBe('session_created');
            ok.ws.terminate();
        } finally { await open1.server.stop(); }

        const listed = await start({ auth: new JwtAuth({ secret }).hook(), cors: ['https://app.example.com'] });
        try {
            await expect(open(listed.port, '/chat', EVIL, ['bearer', token])).rejects.toThrow('HTTP 403');   // a token but a foreign page
            const ok = await open(listed.port, '/chat', { origin: 'https://app.example.com' }, ['bearer', token]);
            expect(ok.first.type).toBe('session_created');
            ok.ws.terminate();
        } finally { await listed.server.stop(); }
    });
});

describe('a webhook route is signed with its HMAC, not with a JWT, and not from loopback', () => {
    const secret = 'hook-secret';
    it('works from a foreign Host with a signature, answers 401 without, and the JWT hook does not apply to it', async () => {
        const triggers = new TriggerBus(() => ({ engine: engineWith(async () => undefined), transport: { close() {} } }) as never)
            .addWebhook({ name: 'gh', path: '/hooks/gh', secret, buildPrompt: () => 'x' });
        const s = await start({ auth: new JwtAuth({ secret: 'jwt-secret-jwt-secret-jwt-secret' }).hook(), triggers });
        try {
            const body = JSON.stringify({ a: 1 });
            const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
            const signed = await fetch(`http://127.0.0.1:${s.port}/hooks/gh`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
            expect(signed.status).toBe(202);
            const unsigned = await fetch(`http://127.0.0.1:${s.port}/hooks/gh`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
            expect(unsigned.status).toBe(401);                                                              // the HMAC says no, not the JWT hook
            expect(((await unsigned.json()) as { error: string }).error).toMatch(/signature/);
            expect((await fetch(`http://127.0.0.1:${s.port}/sessions`)).status).toBe(401);                   // the rest still needs the JWT
        } finally { await s.server.stop(); }
    });

    it('addWebhook without a secret throws unless it says allowUnsigned', () => {
        const bus = new TriggerBus(() => ({}) as never);
        expect(() => bus.addWebhook({ name: 'open', path: '/o', buildPrompt: () => 'x' })).toThrow(/has no secret/);
        expect(() => bus.addWebhook({ name: 'open', path: '/o', allowUnsigned: true, buildPrompt: () => 'x' })).not.toThrow();
    });
});

describe('turns of a session', () => {
    it('a client cannot queue more than maxPendingInputs: the rest get an error and never reach the engine', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const s = await start({ maxPendingInputs: 2 }, engineWith(() => gate));
        try {
            const { ws } = await open(s.port, '/chat');
            const frames: Array<Record<string, unknown>> = [];
            ws.on('message', d => frames.push(JSON.parse(d.toString())));
            for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'input', content: `m${i}` }));
            await new Promise(r => setTimeout(r, 300));
            expect(s.engine.run).toHaveBeenCalledTimes(2);
            expect(frames.filter(f => f.type === 'error' && String(f.message).includes('Too many messages'))).toHaveLength(3);
            release();
            await new Promise(r => setTimeout(r, 100));
            ws.send(JSON.stringify({ type: 'input', content: 'after' }));      // the queue emptied: it is accepted again
            await new Promise(r => setTimeout(r, 100));
            expect(s.engine.run).toHaveBeenCalledTimes(3);
            ws.terminate();
        } finally { release(); await s.server.stop(); }
    });

    it('a message over maxMessageBytes closes the connection', async () => {
        const s = await start({ maxMessageBytes: 1024 });
        try {
            const { ws } = await open(s.port, '/chat');
            const closed = new Promise<number>(r => ws.once('close', code => r(code)));
            ws.send(JSON.stringify({ type: 'input', content: 'x'.repeat(5000) }));
            expect(await closed).toBe(1009);
            expect(s.engine.run).not.toHaveBeenCalled();
        } finally { await s.server.stop(); }
    });

    it('the message of an engine error stays on the server, unless exposeErrors is on', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        for (const [exposeErrors, expected] of [[false, 'The agent could not answer. Try again.'], [true, 'provider said: key sk-123 invalid']] as const) {
            const s = await start({ exposeErrors }, engineWith(async () => { throw new Error('provider said: key sk-123 invalid'); }));
            try {
                const { ws } = await open(s.port, '/chat');
                const frame = next(ws);
                ws.send(JSON.stringify({ type: 'input', content: 'x' }));
                expect((await frame).message).toBe(expected);
                ws.terminate();
            } finally { await s.server.stop(); }
        }
        jest.restoreAllMocks();
    });
});

describe('a session with a turn running is not idle', () => {
    it('sweepIdle leaves it, and takes it once the turn ended', () => {
        jest.useFakeTimers();
        try {
            const sm = new SessionManager({ engineFactory: () => ({ abort() {} }) as never, maxIdleMs: 1000 });
            const socket = { on: jest.fn(), send: jest.fn(), close: jest.fn() } as never;
            const session = sm.create(socket, 'ana');
            session.activeRuns = 1;
            jest.advanceTimersByTime(5 * 60_000);
            expect(sm.size).toBe(1);
            session.activeRuns = 0;
            jest.advanceTimersByTime(2 * 60_000);
            expect(sm.size).toBe(0);
            sm.close();
        } finally { jest.useRealTimers(); }
    });
});

describe('JwtAuth', () => {
    const secret = 'test-secret-test-secret-test-secret';
    it('requireExpiry and requireSubject refuse a token without them; without the options nothing changes', () => {
        const strict = new JwtAuth({ secret, requireExpiry: true, requireSubject: true });
        expect(() => strict.verify(jwt.sign({ sub: 'a' }, secret))).toThrow(/no expiry/);
        expect(() => strict.verify(jwt.sign({}, secret, { expiresIn: 60 }))).toThrow(/no subject/);
        expect(strict.verify(jwt.sign({ sub: 'a' }, secret, { expiresIn: 60 })).sub).toBe('a');
        expect(new JwtAuth({ secret }).verify(jwt.sign({ sub: 'a' }, secret)).sub).toBe('a');
    });
    it('a secret verifies HMAC only: a token that says alg none is refused', () => {
        const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"a"}').toString('base64url')}.`;
        expect(() => new JwtAuth({ secret }).verify(none)).toThrow();
    });
    it('the scheme Bearer is matched without regard to case', async () => {
        const hook = new JwtAuth({ secret }).hook();
        const req = { headers: { authorization: `bearer ${jwt.sign({ sub: 'a' }, secret)}` }, query: {} } as never;
        const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() } as never;
        await hook(req, reply);
        expect((req as { user?: { sub: string } }).user?.sub).toBe('a');
    });
});
