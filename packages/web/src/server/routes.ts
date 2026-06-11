import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { SessionManager } from '../session/SessionManager';
import type { MonitorBus } from '../monitor/MonitorBus';

export function registerRoutes(app: FastifyInstance, sessions: SessionManager, monitorBus?: MonitorBus): void {

    // ── Health ────────────────────────────────────────────────────────────────
    app.get('/health', async () => ({
        status: 'ok',
        sessions: sessions.size,
        monitors: monitorBus?.size ?? 0,
        timestamp: new Date().toISOString(),
    }));

    // ── Sessions ─────────────────────────────────────────────────────────────

    app.get('/sessions', async () => ({ sessions: sessions.list() }));

    app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
        const session = sessions.get(req.params.id);
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        sessions.destroy(req.params.id);
        return { ok: true };
    });

    // ── WebSocket chat ────────────────────────────────────────────────────────
    // Client connects → session is created → messages flow over the socket.
    // The engine sends AgentEvents as JSON frames; the client sends:
    //   { type: 'input', content: '...' }    ← user message
    //   { type: 'abort' }                    ← cancel current run
    app.get('/chat', { websocket: true }, (socket: WebSocket, _req) => {
        let session: ReturnType<SessionManager['create']>;

        try {
            session = sessions.create(socket);
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
                    // Broadcast user input to monitor observers before running
                    monitorBus?.broadcastRunInput(session.id, msg.content);
                    // Fire-and-forget: engine.run() handles its own error boundary
                    void session.engine.run(msg.content).catch((err: unknown) => {
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
        app.get('/monitor', { websocket: true }, (socket: WebSocket, _req) => {
            bus.subscribe(socket);
        });
    }
}
