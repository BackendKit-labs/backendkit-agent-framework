import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { SessionManager } from '../session/SessionManager';
import type { MonitorBus } from '../monitor/MonitorBus';
import type { MetricsCollector } from '../metrics/MetricsCollector';
import { inScope, sessionScope } from '../auth/scope';

export function registerRoutes(
    app: FastifyInstance,
    sessions: SessionManager,
    monitorBus?: MonitorBus,
    metrics?: MetricsCollector,
    metricsPath?: string,
    adminRole = 'admin',
): void {

    // ── Health ────────────────────────────────────────────────────────────────
    app.get('/health', async () => ({
        status: 'ok',
        sessions: sessions.size,
        monitors: monitorBus?.size ?? 0,
        timestamp: new Date().toISOString(),
    }));

    // ── Prometheus metrics ────────────────────────────────────────────────────
    if (metrics) {
        const path = metricsPath ?? '/metrics';
        app.get(path, async (_req, reply) => {
            const body = await metrics.collect();
            reply.header('Content-Type', metrics.contentType).send(body);
        });
    }

    // ── Sessions ─────────────────────────────────────────────────────────────

    // With a user in play, a request sees and ends its own sessions only; `adminRole` sees all of them.
    app.get('/sessions', async (req) => {
        const scope = sessionScope(req.user, adminRole);
        return { sessions: sessions.list().filter(s => inScope(scope, s.userId)) };
    });

    app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
        const scope = sessionScope(req.user, adminRole);
        // list() does not touch the session; get() would reset its idle timer for someone who does not own it
        const visible = sessions.list().find(s => s.id === req.params.id && inScope(scope, s.userId));
        // 404, not 403: another user's session id must not be confirmed to exist
        if (!visible) return reply.code(404).send({ error: 'Session not found' });
        sessions.destroy(req.params.id);
        return { ok: true };
    });

    // ── WebSocket chat ────────────────────────────────────────────────────────
    // Client connects → session is created → messages flow over the socket.
    // The engine sends AgentEvents as JSON frames; the client sends:
    //   { type: 'input', content: '...' }    ← user message
    //   { type: 'abort' }                    ← cancel current run
    app.get('/chat', { websocket: true }, (socket: WebSocket, req) => {
        let session: ReturnType<SessionManager['create']>;

        // Pass authenticated userId if auth is configured (set by JwtAuth preHandler)
        const userId = req.user?.sub;

        try {
            session = sessions.create(socket, userId);
            // Announce session id so the client can reference it
            socket.send(JSON.stringify({ type: 'session_created', sessionId: session.id }));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create session';
            socket.send(JSON.stringify({ type: 'error', message }));
            socket.close();
            return;
        }

        socket.on('message', (raw: Buffer | string) => {
            try {
                const msg = JSON.parse(raw.toString());

                if (msg.type === 'input' && typeof msg.content === 'string') {
                    sessions.get(session.id);
                    metrics?.messageReceived();
                    // Broadcast user input to monitor observers before running
                    monitorBus?.broadcastRunInput(session.id, msg.content);
                    // Track run duration via metrics
                    const finish = metrics?.runStarted();
                    void session.engine.run(msg.content)
                        .then(() => finish?.('success'))
                        .catch((err: unknown) => {
                            finish?.('error');
                            const message = err instanceof Error ? err.message : 'Engine error';
                            socket.send(JSON.stringify({ type: 'error', message }));
                        });
                }

                if (msg.type === 'abort') {
                    session.engine.abort();
                }
            } catch {
                // ignore malformed frames
            }
        });

        // Cleanup is handled by SessionManager's socket.on('close') hook
    });

    // ── WebSocket monitor ─────────────────────────────────────────────────────
    // Read-only observer — receives all session events tagged with sessionId.
    // Protocol (server → client):
    //   { type: 'monitor_hello', sessionIds: string[] }
    //   { type: 'monitor_session_open', sessionId }
    //   { type: 'monitor_session_close', sessionId }
    //   { sessionId, type: 'run_input', content }
    //   { sessionId, ...AgentEvent }
    if (monitorBus) {
        const bus = monitorBus;
        app.get('/monitor', { websocket: true }, (socket: WebSocket, req) => {
            // an observer sees the sessions of its own user only, unless it holds adminRole (or there is no auth)
            bus.subscribe(socket, sessionScope(req.user, adminRole));
        });
    }
}
