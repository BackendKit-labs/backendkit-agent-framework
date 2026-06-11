import { v4 as uuidv4 } from 'uuid';
import type { AgentEngine, AgentEvent } from '@backendkit-labs/agent-core';
import { WebSocketTransport } from '../transport/WebSocketTransport';
import type { MonitorBus } from '../monitor/MonitorBus';
import type { MetricsCollector } from '../metrics/MetricsCollector';
import type { SessionMetaStore } from '../store/SessionMetaStore';
import type { WebSocket } from 'ws';

export interface Session {
    id: string;
    engine: AgentEngine;
    transport: WebSocketTransport;
    createdAt: Date;
    lastActivityAt: Date;
    /** Set when JWT auth is active. */
    userId?: string;
}

export type EngineFactory = (sessionId: string, transport: WebSocketTransport) => AgentEngine;

export interface SessionManagerOptions {
    /** Factory that creates a fresh AgentEngine for a session. Called once per session. */
    engineFactory: EngineFactory;
    /** Max idle time in ms before a session is automatically evicted. Default: 30 minutes. */
    maxIdleMs?: number;
    /** Max concurrent sessions. Rejects new sessions when reached. Default: 100. */
    maxSessions?: number;
    /** Optional monitor bus — broadcasts all session events to connected observers. */
    monitorBus?: MonitorBus;
    /** Optional Prometheus metrics collector. */
    metrics?: MetricsCollector;
    /** Optional durable store for session metadata (Redis, etc.). */
    store?: SessionMetaStore;
}

export class SessionManager {
    private sessions = new Map<string, Session>();
    private readonly maxIdleMs: number;
    private readonly maxSessions: number;
    private readonly engineFactory: EngineFactory;
    private readonly monitorBus: MonitorBus | undefined;
    private readonly metrics: MetricsCollector | undefined;
    private readonly store: SessionMetaStore | undefined;
    private sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(opts: SessionManagerOptions) {
        this.engineFactory = opts.engineFactory;
        this.maxIdleMs = opts.maxIdleMs ?? 30 * 60 * 1000;
        this.maxSessions = opts.maxSessions ?? 100;
        this.monitorBus = opts.monitorBus;
        this.metrics = opts.metrics;
        this.store = opts.store;

        // sweep idle sessions every minute
        this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
        this.sweepTimer.unref?.();
    }

    /** Create a new session and wire a WebSocket to it. */
    create(socket: WebSocket, userId?: string): Session {
        if (this.sessions.size >= this.maxSessions) {
            throw new Error(`Max concurrent sessions (${this.maxSessions}) reached`);
        }

        const id = uuidv4();
        const transport = new WebSocketTransport(socket);

        // Tap emit to fan out every AgentEvent to the monitor bus
        if (this.monitorBus) {
            const bus = this.monitorBus;
            const origEmit = transport.emit.bind(transport);
            transport.emit = (event: AgentEvent) => {
                origEmit(event);
                bus.broadcast(id, event);
            };
        }

        const engine = this.engineFactory(id, transport);
        const now = new Date();

        const session: Session = {
            id,
            engine,
            transport,
            createdAt: now,
            lastActivityAt: now,
            userId,
        };

        this.sessions.set(id, session);
        this.monitorBus?.notifySessionOpen(id);
        this.metrics?.sessionOpened();
        this.store?.set(id, {
            id,
            createdAt: now.toISOString(),
            lastActivityAt: now.toISOString(),
            userId,
        }).catch(() => { /* non-fatal */ });

        socket.on('close', () => this.destroy(id));

        return session;
    }

    get(id: string): Session | undefined {
        const session = this.sessions.get(id);
        if (session) {
            session.lastActivityAt = new Date();
            this.store?.set(id, {
                id,
                createdAt: session.createdAt.toISOString(),
                lastActivityAt: session.lastActivityAt.toISOString(),
                userId: session.userId,
            }).catch(() => { /* non-fatal */ });
        }
        return session;
    }

    destroy(id: string): void {
        const session = this.sessions.get(id);
        if (!session) return;
        try { session.engine.abort(); } catch { /* engine may already be idle */ }
        try { session.transport.close(); } catch { /* may already be closed */ }
        this.sessions.delete(id);
        this.monitorBus?.notifySessionClose(id);
        this.metrics?.sessionClosed();
        this.store?.delete(id).catch(() => { /* non-fatal */ });
    }

    list(): Pick<Session, 'id' | 'createdAt' | 'lastActivityAt' | 'userId'>[] {
        return [...this.sessions.values()].map(({ id, createdAt, lastActivityAt, userId }) => ({
            id, createdAt, lastActivityAt, userId,
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
        this.store?.close().catch(() => { /* non-fatal */ });
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
