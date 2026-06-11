import type { WebSocket } from 'ws';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { MonitorBus } from '../monitor/MonitorBus';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeSocket = WebSocket & {
    _sent: string[];
    _trigger: (event: string, ...args: unknown[]) => void;
};

function makeSocket(readyState = 1 /* OPEN */): FakeSocket {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const socket = {
        readyState,
        send: jest.fn((data: string) => { socket._sent.push(data); }),
        on:   jest.fn((event: string, cb: (...args: unknown[]) => void) => {
            (listeners[event] ??= []).push(cb);
        }),
        _sent: [] as string[],
        _trigger(event: string, ...args: unknown[]) {
            listeners[event]?.forEach(h => h(...args));
        },
    };
    return socket as unknown as FakeSocket;
}

function parse(socket: FakeSocket, index = 0) {
    return JSON.parse(socket._sent[index]);
}

function clearSent(...sockets: FakeSocket[]) {
    sockets.forEach(s => (s._sent.length = 0));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MonitorBus', () => {

    // ── subscribe() ───────────────────────────────────────────────────────────

    describe('subscribe()', () => {
        it('sends monitor_hello with an empty sessionIds list when no sessions are open', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);

            expect(socket._sent).toHaveLength(1);
            expect(parse(socket)).toEqual({ type: 'monitor_hello', sessionIds: [] });
        });

        it('sends monitor_hello listing all currently open sessions', () => {
            const bus = new MonitorBus();
            bus.notifySessionOpen('A');
            bus.notifySessionOpen('B');

            const socket = makeSocket();
            bus.subscribe(socket);

            const frame = parse(socket);
            expect(frame.type).toBe('monitor_hello');
            expect(frame.sessionIds).toHaveLength(2);
            expect(frame.sessionIds).toContain('A');
            expect(frame.sessionIds).toContain('B');
        });

        it('does not send the hello frame when the socket is not OPEN', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket(3 /* CLOSED */);
            bus.subscribe(socket);
            expect(socket._sent).toHaveLength(0);
        });

        it('increments size for each new subscriber', () => {
            const bus = new MonitorBus();
            expect(bus.size).toBe(0);
            bus.subscribe(makeSocket());
            expect(bus.size).toBe(1);
            bus.subscribe(makeSocket());
            expect(bus.size).toBe(2);
        });

        it('removes the socket from the monitor set when the socket closes', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            expect(bus.size).toBe(1);
            socket._trigger('close');
            expect(bus.size).toBe(0);
        });

        it('registers the close handler via socket.on("close", ...)', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
        });

        it('multiple sockets are tracked independently', () => {
            const bus = new MonitorBus();
            const s1  = makeSocket();
            const s2  = makeSocket();
            bus.subscribe(s1);
            bus.subscribe(s2);
            s1._trigger('close');
            expect(bus.size).toBe(1);
            s2._trigger('close');
            expect(bus.size).toBe(0);
        });
    });

    // ── notifySessionOpen() ───────────────────────────────────────────────────

    describe('notifySessionOpen()', () => {
        it('fans out monitor_session_open to all subscribers', () => {
            const bus = new MonitorBus();
            const s1  = makeSocket();
            const s2  = makeSocket();
            bus.subscribe(s1);
            bus.subscribe(s2);
            clearSent(s1, s2);

            bus.notifySessionOpen('sess-1');

            expect(parse(s1)).toEqual({ type: 'monitor_session_open', sessionId: 'sess-1' });
            expect(parse(s2)).toEqual({ type: 'monitor_session_open', sessionId: 'sess-1' });
        });

        it('adds the session so future subscribers see it in monitor_hello', () => {
            const bus = new MonitorBus();
            bus.notifySessionOpen('sess-X');

            const socket = makeSocket();
            bus.subscribe(socket);

            expect(parse(socket).sessionIds).toContain('sess-X');
        });

        it('does not send to a socket in a non-OPEN readyState', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket(2 /* CLOSING */);
            bus.subscribe(socket);
            clearSent(socket);

            bus.notifySessionOpen('sess-Y');
            expect(socket._sent).toHaveLength(0);
        });

        it('tracks multiple sessions independently', () => {
            const bus = new MonitorBus();
            bus.notifySessionOpen('X');
            bus.notifySessionOpen('Y');
            bus.notifySessionOpen('Z');

            const socket = makeSocket();
            bus.subscribe(socket);

            const { sessionIds } = parse(socket);
            expect(sessionIds).toContain('X');
            expect(sessionIds).toContain('Y');
            expect(sessionIds).toContain('Z');
        });
    });

    // ── notifySessionClose() ──────────────────────────────────────────────────

    describe('notifySessionClose()', () => {
        it('fans out monitor_session_close to all subscribers', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            bus.notifySessionOpen('sess-2');
            clearSent(socket);

            bus.notifySessionClose('sess-2');

            expect(parse(socket)).toEqual({ type: 'monitor_session_close', sessionId: 'sess-2' });
        });

        it('removes the session so future subscribers do not see it in monitor_hello', () => {
            const bus = new MonitorBus();
            bus.notifySessionOpen('sess-3');
            bus.notifySessionClose('sess-3');

            const socket = makeSocket();
            bus.subscribe(socket);

            expect(parse(socket).sessionIds).not.toContain('sess-3');
        });

        it('does not throw for an unknown session id', () => {
            const bus = new MonitorBus();
            expect(() => bus.notifySessionClose('ghost')).not.toThrow();
        });

        it('only removes the targeted session, leaving others intact', () => {
            const bus = new MonitorBus();
            bus.notifySessionOpen('keep');
            bus.notifySessionOpen('remove');
            bus.notifySessionClose('remove');

            const socket = makeSocket();
            bus.subscribe(socket);

            const { sessionIds } = parse(socket);
            expect(sessionIds).toContain('keep');
            expect(sessionIds).not.toContain('remove');
        });
    });

    // ── broadcast() ───────────────────────────────────────────────────────────

    describe('broadcast()', () => {
        it('fans out { sessionId, ...event } to all subscribers', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            clearSent(socket);

            const event = { type: 'token', content: 'hello' } as AgentEvent;
            bus.broadcast('sess-A', event);

            expect(parse(socket)).toEqual({ sessionId: 'sess-A', type: 'token', content: 'hello' });
        });

        it('sends to every subscriber', () => {
            const bus = new MonitorBus();
            const sockets = [makeSocket(), makeSocket(), makeSocket()];
            sockets.forEach(s => bus.subscribe(s));
            sockets.forEach(s => clearSent(s));

            bus.broadcast('sess-B', { type: 'token', content: 'x' } as AgentEvent);

            sockets.forEach(s => expect(s._sent).toHaveLength(1));
        });

        it('does not send to a socket that has been closed via its close event', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            socket._trigger('close');
            clearSent(socket);

            bus.broadcast('sess-C', { type: 'token', content: 'x' } as AgentEvent);
            expect(socket._sent).toHaveLength(0);
        });

        it('skips sockets whose readyState is not OPEN', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket(0 /* CONNECTING */);
            bus.subscribe(socket);
            clearSent(socket);

            expect(() =>
                bus.broadcast('sess-D', { type: 'token', content: 'y' } as AgentEvent),
            ).not.toThrow();
            expect(socket._sent).toHaveLength(0);
        });

        it('does not throw when socket.send() throws', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            (socket.send as jest.Mock).mockImplementationOnce(() => { throw new Error('write error'); });
            bus.subscribe(socket);
            clearSent(socket);

            expect(() =>
                bus.broadcast('sess-E', { type: 'token', content: 'z' } as AgentEvent),
            ).not.toThrow();
        });

        it('continues delivering to remaining sockets even if one throws', () => {
            const bus = new MonitorBus();
            const bad  = makeSocket();
            const good = makeSocket();
            (bad.send as jest.Mock).mockImplementation(() => { throw new Error('oops'); });
            bus.subscribe(bad);
            bus.subscribe(good);
            clearSent(bad, good);

            bus.broadcast('sess-F', { type: 'token', content: 'ok' } as AgentEvent);
            expect(good._sent).toHaveLength(1);
        });
    });

    // ── broadcastRunInput() ───────────────────────────────────────────────────

    describe('broadcastRunInput()', () => {
        it('fans out { sessionId, type: "run_input", content } to all subscribers', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket();
            bus.subscribe(socket);
            clearSent(socket);

            bus.broadcastRunInput('sess-G', 'generate the report');

            expect(parse(socket)).toEqual({
                sessionId: 'sess-G',
                type:      'run_input',
                content:   'generate the report',
            });
        });

        it('sends to every subscriber', () => {
            const bus     = new MonitorBus();
            const sockets = [makeSocket(), makeSocket()];
            sockets.forEach(s => { bus.subscribe(s); clearSent(s); });

            bus.broadcastRunInput('sess-H', 'hello');
            sockets.forEach(s => expect(s._sent).toHaveLength(1));
        });

        it('does not send to non-OPEN sockets', () => {
            const bus    = new MonitorBus();
            const socket = makeSocket(3 /* CLOSED */);
            bus.subscribe(socket);

            bus.broadcastRunInput('sess-I', 'x');
            expect(socket._sent).toHaveLength(0);
        });
    });

    // ── size getter ───────────────────────────────────────────────────────────

    describe('size', () => {
        it('tracks the number of active monitor subscriptions across subscribe and close', () => {
            const bus = new MonitorBus();
            const s1  = makeSocket();
            const s2  = makeSocket();

            expect(bus.size).toBe(0);
            bus.subscribe(s1);
            bus.subscribe(s2);
            expect(bus.size).toBe(2);
            s1._trigger('close');
            expect(bus.size).toBe(1);
            s2._trigger('close');
            expect(bus.size).toBe(0);
        });
    });

    // ── fan-out ordering ──────────────────────────────────────────────────────

    describe('fan-out ordering', () => {
        it('delivers frames to subscribers in the order they subscribed', () => {
            const bus      = new MonitorBus();
            const received: number[] = [];

            for (let i = 0; i < 5; i++) {
                const idx    = i;
                const socket = makeSocket();
                (socket.send as jest.Mock).mockImplementation(() => received.push(idx));
                bus.subscribe(socket);
            }
            received.length = 0; // clear hello frames

            bus.notifySessionOpen('ordered');
            expect(received).toEqual([0, 1, 2, 3, 4]);
        });
    });
});
