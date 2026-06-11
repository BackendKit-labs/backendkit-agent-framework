import { v4 as uuidv4 } from 'uuid';
import type { AgentEngine } from '@backendkit-labs/agent-core';
import { WebSocketTransport } from '../transport/WebSocketTransport';
import type { WebSocket } from 'ws';

export interface Session {
    id: string;
    engine: AgentEngine;
    transport: WebSocketTransport;
    createdAt: Date;
    lastActivityAt: Date;
}

export type EngineFactory = (sessionId: string, transport: WebSocketTransport) => AgentEngine;

export interface SessionManagerOptions {
    /** Factory that creates a fresh AgentEngine for a session. Called once per session. */
    engineFactory: EngineFactory;
    /** Max idle time in ms before a session is automatically evicted. Default: 30 minutes. */
    maxIdleMs?: number;
    /** Max concurrent sessions. Rejects new sessions when reached. Default: 100. */
    maxSessions?: number;
}

export class SessionManager {
    private sessions = new Map<string, Session>();
    private readonly maxIdleMs: number;
    private readonly maxSessions: number;
    private readonly engineFactory: EngineFactory;
    private sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(opts: SessionManagerOptions) {
        this.engineFactory = opts.engineFactory;
        this.maxIdleMs = opts.maxIdleMs ?? 30 * 60 * 1000;
        this.maxSessions = opts.maxSessions ?? 100;

        // sweep idle sessions every minute
        this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
        this.sweepTimer.unref?.();
    }

    /** Create a new session and wire a WebSocket to it. */
    create(socket: WebSocket): Session {
        if (this.sessions.size >= this.maxSessions) {
            throw new Error(`Max concurrent sessions (${this.maxSessions}) reached`);
        }

        const id = uuidv4();
        const transport = new WebSocketTransport(socket);
        const engine = this.engineFactory(id, transport);

        const session: Session = {
            id,
            engine,
            transport,
            createdAt: new Date(),
            lastActivityAt: new Date(),
        };

        this.sessions.set(id, session);

        socket.on('close', () => this.destroy(id));

        return session;
    }

    get(id: string): Session | undefined {
        const session = this.sessions.get(id);
        if (session) session.lastActivityAt = new Date();
        return session;
    }

    destroy(id: string): void {
        const session = this.sessions.get(id);
        if (!session) return;
        try { session.engine.abort(); } catch { /* engine may already be idle */ }
        try { session.transport.close(); } catch { /* may already be closed */ }
        this.sessions.delete(id);
    }

    list(): Pick<Session, 'id' | 'createdAt' | 'lastActivityAt'>[] {
        return [...this.sessions.values()].map(({ id, createdAt, lastActivityAt }) => ({
            id, createdAt, lastActivityAt,
        }));
    }

    get size(): number {
        return this.sessions.size;
    }

    close(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
        for (const id of [...this.sessions.keys()]) this.destroy(id);
    }

    private sweepIdle(): void {
        const cutoff = Date.now() - this.maxIdleMs;
        for (const [id, session] of this.sessions) {
            if (session.lastActivityAt.getTime() < cutoff) {
                this.destroy(id);
            }
        }
    }
}
