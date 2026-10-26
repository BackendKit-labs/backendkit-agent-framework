import type { WebSocket } from 'ws';
import type { AgentEngine } from '@backendkit-labs/agent-core';
import { SessionManager } from '../session/SessionManager';
import type { SessionMetaStore } from '../store/SessionMetaStore';

function socket(): WebSocket {
    return { on: jest.fn(), send: jest.fn(), close: jest.fn(), readyState: 1 } as unknown as WebSocket;
}
const engine = () => ({ run: jest.fn(), abort: jest.fn(), use: jest.fn(), getTools: jest.fn().mockReturnValue([]) }) as unknown as AgentEngine;
function store() {
    return {
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        getAll: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SessionMetaStore>;
}

describe('SessionManager.get — activity is persisted at most once per interval', () => {
    let now: number;
    const advance = (ms: number) => { now += ms; jest.setSystemTime(now); };
    beforeEach(() => { now = 1_700_000_000_000; jest.useFakeTimers(); jest.setSystemTime(now); });
    afterEach(() => { jest.useRealTimers(); });

    it('a burst of get() calls costs one store write, not one per message', () => {
        const s = store();
        const mgr = new SessionManager({ engineFactory: engine, store: s, activityPersistIntervalMs: 30_000 });
        const { id } = mgr.create(socket());
        expect(s.set).toHaveBeenCalledTimes(1); // creation

        for (let i = 0; i < 50; i++) { advance(100); mgr.get(id); }
        expect(s.set).toHaveBeenCalledTimes(1);
        mgr.close();
    });

    it('writes again once the interval has elapsed, with the fresh timestamp', () => {
        const s = store();
        const mgr = new SessionManager({ engineFactory: engine, store: s, activityPersistIntervalMs: 30_000 });
        const { id } = mgr.create(socket());
        advance(31_000);
        mgr.get(id);
        expect(s.set).toHaveBeenCalledTimes(2);
        expect(s.set.mock.calls[1][1].lastActivityAt).toBe(new Date(now).toISOString());
        mgr.close();
    });

    it('in-memory activity is exact on every call, even when nothing is written', () => {
        const s = store();
        const mgr = new SessionManager({ engineFactory: engine, store: s });
        const { id } = mgr.create(socket());
        advance(5_000);
        const session = mgr.get(id)!;
        expect(session.lastActivityAt.getTime()).toBe(now);
        expect(s.set).toHaveBeenCalledTimes(1);
        mgr.close();
    });

    it('activityPersistIntervalMs: 0 writes on every get() (previous behavior)', () => {
        const s = store();
        const mgr = new SessionManager({ engineFactory: engine, store: s, activityPersistIntervalMs: 0 });
        const { id } = mgr.create(socket());
        mgr.get(id); mgr.get(id); mgr.get(id);
        expect(s.set).toHaveBeenCalledTimes(4);
        mgr.close();
    });

    it('a destroyed session leaves no bookkeeping behind', () => {
        const s = store();
        const mgr = new SessionManager({ engineFactory: engine, store: s });
        const { id } = mgr.create(socket());
        mgr.destroy(id);
        expect((mgr as unknown as { lastPersisted: Map<string, number> }).lastPersisted.size).toBe(0);
        mgr.close();
    });
});
