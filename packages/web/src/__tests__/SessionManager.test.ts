import type { WebSocket } from 'ws';
import type { AgentEngine, AgentEvent } from '@backendkit-labs/agent-core';
import { SessionManager } from '../session/SessionManager';
import type { MonitorBus } from '../monitor/MonitorBus';
import type { MetricsCollector } from '../metrics/MetricsCollector';
import type { SessionMetaStore } from '../store/SessionMetaStore';
import type { WebSocketTransport } from '../transport/WebSocketTransport';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeSocket = WebSocket & { _trigger: (event: string, ...args: unknown[]) => void };

function makeSocket(): FakeSocket {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
        on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
            (listeners[event] ??= []).push(cb);
        }),
        send:      jest.fn(),
        close:     jest.fn(),
        readyState: 1 as const,
        _trigger(event: string, ...args: unknown[]) {
            listeners[event]?.forEach(h => h(...args));
        },
    } as unknown as FakeSocket;
}

function makeEngine(): jest.Mocked<Pick<AgentEngine, 'run' | 'abort'>> & AgentEngine {
    return {
        run:      jest.fn().mockResolvedValue(undefined),
        abort:    jest.fn(),
        use:      jest.fn(),
        getTools: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<Pick<AgentEngine, 'run' | 'abort'>> & AgentEngine;
}

function makeMonitorBus(): jest.Mocked<MonitorBus> {
    return {
        notifySessionOpen:  jest.fn(),
        notifySessionClose: jest.fn(),
        broadcast:          jest.fn(),
        broadcastRunInput:  jest.fn(),
        subscribe:          jest.fn(),
        size: 0,
    } as unknown as jest.Mocked<MonitorBus>;
}

function makeMetrics(): jest.Mocked<MetricsCollector> {
    return {
        sessionOpened: jest.fn(),
        sessionClosed: jest.fn(),
    } as unknown as jest.Mocked<MetricsCollector>;
}

function makeStore(): jest.Mocked<SessionMetaStore> {
    return {
        set:    jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        close:  jest.fn().mockResolvedValue(undefined),
        getAll: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SessionMetaStore>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionManager', () => {
    let engine: ReturnType<typeof makeEngine>;
    let engineFactory: jest.Mock;

    beforeEach(() => {
        engine = makeEngine();
        engineFactory = jest.fn().mockReturnValue(engine);
    });

    // ── who the session is for (SPEC-0044) ─────────────

    describe('the authenticated user reaches the engine factory', () => {
        it('hands the factory the userId of the session, so the engine acts for that person', () => {
            const mgr = new SessionManager({ engineFactory });
            mgr.create(makeSocket(), 'u-42');
            expect(engineFactory).toHaveBeenCalledWith(expect.any(String), expect.anything(), { userId: 'u-42' });
        });

        it('with no authentication there is no user to hand over', () => {
            const mgr = new SessionManager({ engineFactory });
            mgr.create(makeSocket());
            expect(engineFactory).toHaveBeenCalledWith(expect.any(String), expect.anything(), {});
        });
    });

    // ── create() ──────────────────────────────────────────────────────────────

    describe('create()', () => {
        it('returns a session with a uuid id and timestamps', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());

            expect(session.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
            expect(session.createdAt).toBeInstanceOf(Date);
            expect(session.lastActivityAt).toBeInstanceOf(Date);
            expect(session.engine).toBe(engine);
            mgr.close();
        });

        it('stores the optional userId', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket(), 'usr-99');
            expect(session.userId).toBe('usr-99');
            mgr.close();
        });

        it('increments size', () => {
            const mgr = new SessionManager({ engineFactory });
            expect(mgr.size).toBe(0);
            mgr.create(makeSocket());
            expect(mgr.size).toBe(1);
            mgr.create(makeSocket());
            expect(mgr.size).toBe(2);
            mgr.close();
        });

        it('calls engineFactory with the session id and a transport', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());
            expect(engineFactory).toHaveBeenCalledWith(session.id, expect.any(Object), {});
            mgr.close();
        });

        it('throws when maxSessions is reached', () => {
            const mgr = new SessionManager({ engineFactory, maxSessions: 2 });
            mgr.create(makeSocket());
            mgr.create(makeSocket());
            expect(() => mgr.create(makeSocket())).toThrow('Max concurrent sessions (2) reached');
            mgr.close();
        });

        it('notifies monitorBus.notifySessionOpen', () => {
            const monitorBus = makeMonitorBus();
            const mgr        = new SessionManager({ engineFactory, monitorBus });
            const session    = mgr.create(makeSocket());
            expect(monitorBus.notifySessionOpen).toHaveBeenCalledWith(session.id, undefined);
            mgr.close();
        });

        it('tells the monitorBus who owns the session, so observers can be scoped to their user', () => {
            const monitorBus = makeMonitorBus();
            const mgr        = new SessionManager({ engineFactory, monitorBus });
            const session    = mgr.create(makeSocket(), 'alice');
            expect(monitorBus.notifySessionOpen).toHaveBeenCalledWith(session.id, 'alice');
            mgr.close();
        });

        it('calls metrics.sessionOpened()', () => {
            const metrics = makeMetrics();
            const mgr     = new SessionManager({ engineFactory, metrics });
            mgr.create(makeSocket());
            expect(metrics.sessionOpened).toHaveBeenCalledTimes(1);
            mgr.close();
        });

        it('calls store.set() with session metadata', async () => {
            const store   = makeStore();
            const mgr     = new SessionManager({ engineFactory, store });
            const session = mgr.create(makeSocket());
            await Promise.resolve(); // flush micro-tasks
            expect(store.set).toHaveBeenCalledWith(
                session.id,
                expect.objectContaining({ id: session.id }),
            );
            mgr.close();
        });

        it('fan-outs AgentEvents to monitorBus.broadcast', () => {
            const monitorBus = makeMonitorBus();
            const mgr        = new SessionManager({ engineFactory, monitorBus });
            const session    = mgr.create(makeSocket());

            // Simulate the engine emitting an event via the transport
            const event: AgentEvent = { type: 'token', content: 'hi' } as AgentEvent;
            (session.transport as WebSocketTransport).emit(event);

            expect(monitorBus.broadcast).toHaveBeenCalledWith(session.id, event);
            mgr.close();
        });

        it('destroys the session automatically on socket close', () => {
            const mgr    = new SessionManager({ engineFactory });
            const socket = makeSocket();
            mgr.create(socket);
            expect(mgr.size).toBe(1);
            socket._trigger('close');
            expect(mgr.size).toBe(0);
            mgr.close();
        });
    });

    // ── get() ─────────────────────────────────────────────────────────────────

    describe('get()', () => {
        it('returns undefined for an unknown id', () => {
            const mgr = new SessionManager({ engineFactory });
            expect(mgr.get('does-not-exist')).toBeUndefined();
            mgr.close();
        });

        it('returns the session for a known id', () => {
            const mgr     = new SessionManager({ engineFactory });
            const created = mgr.create(makeSocket());
            const fetched = mgr.get(created.id);
            expect(fetched).toBeDefined();
            expect(fetched!.id).toBe(created.id);
            mgr.close();
        });

        it('updates lastActivityAt on each call', async () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());
            const before  = session.lastActivityAt.getTime();
            await new Promise(r => setTimeout(r, 5));
            mgr.get(session.id);
            expect(session.lastActivityAt.getTime()).toBeGreaterThan(before);
            mgr.close();
        });
    });

    // ── destroy() ─────────────────────────────────────────────────────────────

    describe('destroy()', () => {
        it('removes the session from the map', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());
            mgr.destroy(session.id);
            expect(mgr.size).toBe(0);
            expect(mgr.get(session.id)).toBeUndefined();
            mgr.close();
        });

        it('calls engine.abort()', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());
            mgr.destroy(session.id);
            expect(engine.abort).toHaveBeenCalled();
            mgr.close();
        });

        it('notifies monitorBus.notifySessionClose', () => {
            const monitorBus = makeMonitorBus();
            const mgr        = new SessionManager({ engineFactory, monitorBus });
            const session    = mgr.create(makeSocket());
            mgr.destroy(session.id);
            expect(monitorBus.notifySessionClose).toHaveBeenCalledWith(session.id);
            mgr.close();
        });

        it('calls metrics.sessionClosed()', () => {
            const metrics = makeMetrics();
            const mgr     = new SessionManager({ engineFactory, metrics });
            const session = mgr.create(makeSocket());
            mgr.destroy(session.id);
            expect(metrics.sessionClosed).toHaveBeenCalledTimes(1);
            mgr.close();
        });

        it('calls store.delete()', async () => {
            const store   = makeStore();
            const mgr     = new SessionManager({ engineFactory, store });
            const session = mgr.create(makeSocket());
            mgr.destroy(session.id);
            await Promise.resolve();
            expect(store.delete).toHaveBeenCalledWith(session.id);
            mgr.close();
        });

        it('is a no-op for an unknown id', () => {
            const mgr = new SessionManager({ engineFactory });
            expect(() => mgr.destroy('ghost')).not.toThrow();
            mgr.close();
        });

        it('does not double-decrement when the same id is destroyed twice', () => {
            const mgr     = new SessionManager({ engineFactory });
            const session = mgr.create(makeSocket());
            mgr.destroy(session.id);
            expect(() => mgr.destroy(session.id)).not.toThrow();
            expect(engine.abort).toHaveBeenCalledTimes(1);
            mgr.close();
        });
    });

    // ── list() ────────────────────────────────────────────────────────────────

    describe('list()', () => {
        it('returns an empty array when no sessions exist', () => {
            const mgr = new SessionManager({ engineFactory });
            expect(mgr.list()).toEqual([]);
            mgr.close();
        });

        it('returns metadata for all active sessions', () => {
            const mgr = new SessionManager({ engineFactory });
            mgr.create(makeSocket(), 'alice');
            mgr.create(makeSocket(), 'bob');
            const list = mgr.list();
            expect(list).toHaveLength(2);
            expect(list[0]).toHaveProperty('id');
            expect(list[0]).toHaveProperty('createdAt');
            expect(list[0]).toHaveProperty('lastActivityAt');
        });

        it('does not expose engine or transport on list items', () => {
            const mgr     = new SessionManager({ engineFactory });
            mgr.create(makeSocket());
            const [item] = mgr.list();
            expect(item).not.toHaveProperty('engine');
            expect(item).not.toHaveProperty('transport');
            mgr.close();
        });
    });

    // ── close() ───────────────────────────────────────────────────────────────

    describe('close()', () => {
        it('destroys all sessions', () => {
            const mgr = new SessionManager({ engineFactory });
            mgr.create(makeSocket());
            mgr.create(makeSocket());
            mgr.close();
            expect(mgr.size).toBe(0);
        });

        it('calls engine.abort() for every open session', () => {
            const eng2   = makeEngine();
            const fac    = jest.fn()
                .mockReturnValueOnce(engine)
                .mockReturnValueOnce(eng2);
            const mgr = new SessionManager({ engineFactory: fac });
            mgr.create(makeSocket());
            mgr.create(makeSocket());
            mgr.close();
            expect(engine.abort).toHaveBeenCalled();
            expect(eng2.abort).toHaveBeenCalled();
        });
    });

    // ── idle sweep ────────────────────────────────────────────────────────────

    describe('idle sweep', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('evicts sessions idle longer than maxIdleMs', () => {
            const mgr     = new SessionManager({ engineFactory, maxIdleMs: 5_000 });
            const session = mgr.create(makeSocket());
            // Simulate the session being idle for 6 seconds
            session.lastActivityAt = new Date(Date.now() - 6_000);
            jest.advanceTimersByTime(60_001);
            expect(mgr.size).toBe(0);
            mgr.close();
        });

        it('keeps sessions that are still within maxIdleMs', () => {
            const mgr = new SessionManager({ engineFactory, maxIdleMs: 120_000 });
            mgr.create(makeSocket());
            // Sweep fires (60s), session is only 60s old, max is 120s
            jest.advanceTimersByTime(60_001);
            expect(mgr.size).toBe(1);
            mgr.close();
        });

        it('does not fire if close() was called before the interval', () => {
            const mgr     = new SessionManager({ engineFactory, maxIdleMs: 1 });
            const session = mgr.create(makeSocket());
            session.lastActivityAt = new Date(Date.now() - 10_000);
            mgr.close(); // clears the timer
            jest.advanceTimersByTime(60_001);
            // sweep never ran — the session was already destroyed by close()
            expect(engine.abort).toHaveBeenCalledTimes(1); // only from close()
        });
    });
});
