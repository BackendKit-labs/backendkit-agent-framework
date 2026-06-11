import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { SessionManager } from '../session/SessionManager';

export function registerRoutes(app: FastifyInstance, sessions: SessionManager): void {

    // ── Health ────────────────────────────────────────────────────────────────
    app.get('/health', async () => ({
        status: 'ok',
        sessions: sessions.size,
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
                    // Touch lastActivityAt via get()
                    sessions.get(session.id);
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
}
