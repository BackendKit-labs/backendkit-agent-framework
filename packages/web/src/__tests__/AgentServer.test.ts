/**
 * Integration tests for AgentServer.
 * Each describe block starts a real Fastify server on a random port (port: 0)
 * and tears it down in afterAll so tests are fully isolated.
 */
import WsClient from 'ws';
import { AgentServer } from '../server/AgentServer';
import type { AgentEngine } from '@backendkit-labs/agent-core';
import type { EngineFactory } from '../session/SessionManager';

jest.setTimeout(15_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEngine(): jest.Mocked<AgentEngine> {
    return {
        run:      jest.fn().mockResolvedValue(undefined),
        abort:    jest.fn(),
        use:      jest.fn(),
        getTools: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AgentEngine>;
}

function makeFactory(eng?: jest.Mocked<AgentEngine>): { engine: jest.Mocked<AgentEngine>; factory: jest.MockedFunction<EngineFactory> } {
    const engine  = eng ?? makeEngine();
    const factory = jest.fn().mockReturnValue(engine) as unknown as jest.MockedFunction<EngineFactory>;
    return { engine, factory };
}

async function startServer(
    opts: Partial<ConstructorParameters<typeof AgentServer>[0]> &
          Pick<ConstructorParameters<typeof AgentServer>[0], 'engineFactory'>,
): Promise<{ server: AgentServer; port: number }> {
    const server  = new AgentServer({ port: 0, host: '127.0.0.1', ...opts });
    const address = await server.start();
    const port    = parseInt(address.split(':').pop()!, 10);
    return { server, port };
}

async function httpGet(port: number, path: string, headers: Record<string, string> = {}) {
    const res  = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    const body = (() => { try { return JSON.parse(text); } catch { return text; } })();
    return { status: res.status, body, headers: res.headers };
}

async function httpDelete(port: number, path: string) {
    const res  = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
}

async function httpOptions(port: number, path: string) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'OPTIONS' });
    return { status: res.status, headers: res.headers };
}

type WsHandle = { ws: InstanceType<typeof WsClient>; firstMsg: Record<string, unknown> };

function connectWs(port: number, path: string): Promise<WsHandle> {
    return new Promise((resolve, reject) => {
        const ws = new WsClient(`ws://127.0.0.1:${port}${path}`);
        const t  = setTimeout(() => reject(new Error(`WS connect timeout: ${path}`)), 5_000);
        ws.once('message', data => {
            clearTimeout(t);
            resolve({ ws, firstMsg: JSON.parse(data.toString()) });
        });
        ws.once('error', err => { clearTimeout(t); reject(err); });
    });
}

function nextMsg(ws: InstanceType<typeof WsClient>, ms = 3_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WS message timeout')), ms);
        ws.once('message', data => { clearTimeout(t); resolve(JSON.parse(data.toString())); });
        ws.once('error',   err  => { clearTimeout(t); reject(err); });
    });
}

function closeWs(ws: InstanceType<typeof WsClient>): Promise<void> {
    return new Promise(resolve => {
        if (ws.readyState === ws.CLOSED) { resolve(); return; }
        ws.once('close', resolve);
        ws.close();
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentServer', () => {

    // ── getters ───────────────────────────────────────────────────────────────

    describe('getters', () => {
        it('port returns the configured port', () => {
            const { factory } = makeFactory();
            expect(new AgentServer({ port: 4567, engineFactory: factory }).port).toBe(4567);
        });

        it('binds to loopback unless a host is given', async () => {
            const { factory } = makeFactory();
            const srv = new AgentServer({ port: 0, engineFactory: factory });
            const address = await srv.start();
            try { expect(address).toContain('127.0.0.1'); } finally { await srv.stop(); }
        });

        it('port defaults to 3000', () => {
            const { factory } = makeFactory();
            expect(new AgentServer({ engineFactory: factory }).port).toBe(3000);
        });

        it('sessionManager exposes a SessionManager', () => {
            const { factory } = makeFactory();
            const srv = new AgentServer({ engineFactory: factory });
            expect(typeof srv.sessionManager.create).toBe('function');
            expect(typeof srv.sessionManager.destroy).toBe('function');
        });

        it('monitorBus exposes a MonitorBus', () => {
            const { factory } = makeFactory();
            const srv = new AgentServer({ engineFactory: factory });
            expect(typeof srv.monitorBus.subscribe).toBe('function');
            expect(typeof srv.monitorBus.broadcast).toBe('function');
        });
    });

    // ── HTTP routes ───────────────────────────────────────────────────────────

    describe('HTTP routes', () => {
        const { factory } = makeFactory();
        let server: AgentServer;
        let port: number;

        beforeAll(async () => { ({ server, port } = await startServer({ engineFactory: factory })); });
        afterAll(async ()  => { await server.stop(); });

        it('GET /health → 200 with status ok', async () => {
            const { status, body } = await httpGet(port, '/health');
            expect(status).toBe(200);
            expect(body.status).toBe('ok');
        });

        it('GET /health includes sessions, monitors, and timestamp', async () => {
            const { body } = await httpGet(port, '/health');
            expect(typeof body.sessions).toBe('number');
            expect(typeof body.monitors).toBe('number');
            expect(typeof body.timestamp).toBe('string');
        });

        it('GET /sessions → 200 with empty list initially', async () => {
            const { status, body } = await httpGet(port, '/sessions');
            expect(status).toBe(200);
            expect(body.sessions).toEqual([]);
        });

        it('DELETE /sessions/:id → 404 for unknown id', async () => {
            const { status, body } = await httpDelete(port, '/sessions/ghost');
            expect(status).toBe(404);
            expect((body as Record<string, unknown>).error).toBe('Session not found');
        });

        it('GET /metrics → 404 when metrics are not enabled', async () => {
            const { status } = await httpGet(port, '/metrics');
            expect(status).toBe(404);
        });
    });

    // ── metrics endpoint ──────────────────────────────────────────────────────

    describe('metrics endpoint', () => {
        let server: AgentServer;
        let port: number;

        beforeAll(async () => {
            const { factory } = makeFactory();
            ({ server, port } = await startServer({
                engineFactory: factory,
                metrics: { enabled: true, collectNodeMetrics: false },
            }));
        });
        afterAll(async () => { await server.stop(); });

        it('GET /metrics → 200 with Prometheus content-type', async () => {
            const { status, headers } = await httpGet(port, '/metrics');
            expect(status).toBe(200);
            expect(headers.get('content-type')).toContain('text/plain');
        });

        it('GET /metrics body contains bk_ metric families', async () => {
            const { body } = await httpGet(port, '/metrics');
            expect(body).toContain('bk_sessions_active');
        });

        it('uses a custom path when metrics.path is set', async () => {
            const { factory } = makeFactory();
            const { server: s2, port: p2 } = await startServer({
                engineFactory: factory,
                metrics: { enabled: true, path: '/prom', collectNodeMetrics: false },
            });
            try {
                expect((await httpGet(p2, '/prom')).status).toBe(200);
                expect((await httpGet(p2, '/metrics')).status).toBe(404);
            } finally {
                await s2.stop();
            }
        });
    });

    // ── CORS ──────────────────────────────────────────────────────────────────

    describe('CORS', () => {
        const { factory } = makeFactory();
        let server: AgentServer;
        let port: number;

        beforeAll(async () => { ({ server, port } = await startServer({ engineFactory: factory })); });
        afterAll(async ()  => { await server.stop(); });

        it('sets Access-Control-Allow-Origin: * by default', async () => {
            const { headers } = await httpGet(port, '/health');
            expect(headers.get('access-control-allow-origin')).toBe('*');
        });

        it('OPTIONS preflight → 204', async () => {
            const { status } = await httpOptions(port, '/health');
            expect(status).toBe(204);
        });

        it('with several origins echoes the request origin that is listed, never a joined list', async () => {
            const { factory: f3 } = makeFactory();
            const { server: s3, port: p3 } = await startServer({
                engineFactory: f3,
                cors: ['https://a.example.com', 'https://b.example.com'],
            });
            try {
                const b = await httpGet(p3, '/health', { Origin: 'https://b.example.com' });
                expect(b.headers.get('access-control-allow-origin')).toBe('https://b.example.com');
                expect(b.headers.get('vary')).toMatch(/Origin/i);
                const other = await httpGet(p3, '/health', { Origin: 'https://evil.example.com' });
                expect(other.headers.get('access-control-allow-origin')).toBeNull();
                const none = await httpGet(p3, '/health');
                expect(none.headers.get('access-control-allow-origin')).toBeNull();
            } finally {
                await s3.stop();
            }
        });

        it('uses custom cors origin when provided', async () => {
            const { factory: f2 } = makeFactory();
            const { server: s2, port: p2 } = await startServer({
                engineFactory: f2,
                cors: 'https://app.example.com',
            });
            try {
                const { headers } = await httpGet(p2, '/health');
                expect(headers.get('access-control-allow-origin')).toBe('https://app.example.com');
            } finally {
                await s2.stop();
            }
        });
    });

    // ── WebSocket /chat ───────────────────────────────────────────────────────

    describe('WebSocket /chat', () => {
        let server: AgentServer;
        let port: number;
        let engine: jest.Mocked<AgentEngine>;

        beforeAll(async () => {
            const made = makeFactory();
            engine = made.engine;
            ({ server, port } = await startServer({ engineFactory: made.factory }));
        });
        afterAll(async () => { await server.stop(); });
        beforeEach(() => { engine.run.mockClear(); engine.abort.mockClear(); });

        it('sends session_created frame on connect', async () => {
            const { ws, firstMsg } = await connectWs(port, '/chat');
            try {
                expect(firstMsg.type).toBe('session_created');
                expect(typeof firstMsg.sessionId).toBe('string');
            } finally {
                await closeWs(ws);
            }
        });

        it('registers the session in SessionManager', async () => {
            const { ws } = await connectWs(port, '/chat');
            try {
                expect(server.sessionManager.size).toBe(1);
            } finally {
                await closeWs(ws);
                await new Promise(r => setTimeout(r, 30));
            }
        });

        it('removes the session when the socket closes', async () => {
            const { ws } = await connectWs(port, '/chat');
            await closeWs(ws);
            await new Promise(r => setTimeout(r, 50));
            expect(server.sessionManager.size).toBe(0);
        });

        it('calls engine.run() with the input content', async () => {
            const { ws } = await connectWs(port, '/chat');
            try {
                ws.send(JSON.stringify({ type: 'input', content: 'hello agent' }));
                await new Promise(r => setTimeout(r, 100));
                expect(engine.run).toHaveBeenCalledWith('hello agent');
            } finally {
                await closeWs(ws);
            }
        });

        it('calls engine.abort() on abort message', async () => {
            const { ws } = await connectWs(port, '/chat');
            try {
                ws.send(JSON.stringify({ type: 'abort' }));
                await new Promise(r => setTimeout(r, 50));
                expect(engine.abort).toHaveBeenCalled();
            } finally {
                await closeWs(ws);
            }
        });

        it('sends error frame when engine.run() rejects', async () => {
            engine.run.mockRejectedValueOnce(new Error('engine crashed'));
            const { ws } = await connectWs(port, '/chat');
            try {
                const errFrame = nextMsg(ws);
                ws.send(JSON.stringify({ type: 'input', content: 'fail' }));
                const frame = await errFrame;
                expect(frame.type).toBe('error');
                expect(frame.message).toBe('engine crashed');
            } finally {
                await closeWs(ws);
            }
        });

        it('ignores malformed (non-JSON) messages silently', async () => {
            const { ws } = await connectWs(port, '/chat');
            try {
                ws.send('not json {{{');
                await new Promise(r => setTimeout(r, 50));
                expect(engine.run).not.toHaveBeenCalled();
            } finally {
                await closeWs(ws);
            }
        });

        it('DELETE /sessions/:id → 200 and removes session', async () => {
            const { ws, firstMsg } = await connectWs(port, '/chat');
            try {
                const { status } = await httpDelete(port, `/sessions/${firstMsg.sessionId}`);
                expect(status).toBe(200);
                expect(server.sessionManager.get(firstMsg.sessionId as string)).toBeUndefined();
            } finally {
                await closeWs(ws);
            }
        });

        it('sends error frame and closes when maxSessions is reached', async () => {
            const { factory: f2 } = makeFactory();
            const { server: s2, port: p2 } = await startServer({ engineFactory: f2, maxSessions: 1 });
            let ws1: InstanceType<typeof WsClient> | undefined;
            let ws2: InstanceType<typeof WsClient> | undefined;
            try {
                const h1 = await connectWs(p2, '/chat');
                ws1 = h1.ws;
                const h2 = await connectWs(p2, '/chat');
                ws2 = h2.ws;
                expect(h2.firstMsg.type).toBe('error');
                expect(String(h2.firstMsg.message)).toContain('Max concurrent sessions');
            } finally {
                ws1 && await closeWs(ws1);
                ws2 && await closeWs(ws2);
                await s2.stop();
            }
        });
    });

    // ── WebSocket /monitor ────────────────────────────────────────────────────

    describe('WebSocket /monitor', () => {
        let server: AgentServer;
        let port: number;

        beforeAll(async () => {
            const { factory } = makeFactory();
            ({ server, port } = await startServer({ engineFactory: factory }));
        });
        afterAll(async () => { await server.stop(); });

        it('sends monitor_hello on connect', async () => {
            const { ws, firstMsg } = await connectWs(port, '/monitor');
            try {
                expect(firstMsg.type).toBe('monitor_hello');
                expect(Array.isArray(firstMsg.sessionIds)).toBe(true);
            } finally {
                await closeWs(ws);
            }
        });

        it('monitor_hello lists sessions already open', async () => {
            const { ws: chatWs, firstMsg: welcome } = await connectWs(port, '/chat');
            try {
                const { ws: monWs, firstMsg } = await connectWs(port, '/monitor');
                try {
                    expect((firstMsg.sessionIds as string[])).toContain(welcome.sessionId);
                } finally {
                    await closeWs(monWs);
                }
            } finally {
                await closeWs(chatWs);
            }
        });

        it('broadcasts monitor_session_open when a chat session connects', async () => {
            const { ws: monWs } = await connectWs(port, '/monitor');
            try {
                const openFrame = nextMsg(monWs);
                const { ws: chatWs } = await connectWs(port, '/chat');
                try {
                    const frame = await openFrame;
                    expect(frame.type).toBe('monitor_session_open');
                    expect(typeof frame.sessionId).toBe('string');
                } finally {
                    await closeWs(chatWs);
                }
            } finally {
                await closeWs(monWs);
            }
        });

        it('broadcasts monitor_session_close when a chat session disconnects', async () => {
            const { ws: monWs } = await connectWs(port, '/monitor');
            try {
                const { ws: chatWs, firstMsg } = await connectWs(port, '/chat');
                // consume the session_open frame from monitor
                await nextMsg(monWs);
                const closeFrame = nextMsg(monWs);
                await closeWs(chatWs);
                const frame = await closeFrame;
                expect(frame.type).toBe('monitor_session_close');
                expect(frame.sessionId).toBe(firstMsg.sessionId);
            } finally {
                await closeWs(monWs);
            }
        });
    });

    // ── auth hook ────────────────────────────────────────────────────────────

    describe('auth hook', () => {
        let server: AgentServer;
        let port: number;

        beforeAll(async () => {
            const { factory } = makeFactory();
            ({ server, port } = await startServer({
                engineFactory: factory,
                auth: async (_req, reply) => { reply.code(401).send({ error: 'Unauthorized' }); },
            }));
        });
        afterAll(async () => { await server.stop(); });

        it('blocks GET /health with 401', async () => {
            expect((await httpGet(port, '/health')).status).toBe(401);
        });

        it('blocks GET /sessions with 401', async () => {
            expect((await httpGet(port, '/sessions')).status).toBe(401);
        });
    });

    // ── stop() ───────────────────────────────────────────────────────────────

    describe('stop()', () => {
        it('closes the HTTP server — further requests fail', async () => {
            const { factory } = makeFactory();
            const { server, port } = await startServer({ engineFactory: factory });
            await server.stop();
            await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
        });

        it('destroys all active sessions', async () => {
            const { factory } = makeFactory();
            const { server, port } = await startServer({ engineFactory: factory });
            const { ws } = await connectWs(port, '/chat');
            expect(server.sessionManager.size).toBe(1);
            await server.stop();
            expect(server.sessionManager.size).toBe(0);
            await closeWs(ws);
        });

        it('calls triggerBus.start() on start()', async () => {
            const { factory } = makeFactory();
            const triggers = { start: jest.fn(), close: jest.fn().mockResolvedValue(undefined), registerRoutes: jest.fn() } as any;
            const { server } = await startServer({ engineFactory: factory, triggers });
            expect(triggers.start).toHaveBeenCalledTimes(1);
            await server.stop();
        });

        it('calls triggerBus.close() on stop()', async () => {
            const { factory } = makeFactory();
            const triggers = { start: jest.fn(), close: jest.fn().mockResolvedValue(undefined), registerRoutes: jest.fn() } as any;
            const { server } = await startServer({ engineFactory: factory, triggers });
            await server.stop();
            expect(triggers.close).toHaveBeenCalledTimes(1);
        });
    });
});
