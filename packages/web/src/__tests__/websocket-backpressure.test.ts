import type { WebSocket } from 'ws';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { WebSocketTransport, DEFAULT_MAX_BUFFERED_BYTES } from '../transport/WebSocketTransport';
import { MonitorBus } from '../monitor/MonitorBus';

type Fake = WebSocket & { _sent: string[]; bufferedAmount: number };

function fake(bufferedAmount = 0): Fake {
    const socket = {
        readyState: 1,
        bufferedAmount,
        _sent: [] as string[],
        send: jest.fn((d: string) => { socket._sent.push(d); }),
        close: jest.fn(),
        on: jest.fn(),
    };
    return socket as unknown as Fake;
}

const token = (content: string): AgentEvent => ({ type: 'token', content } as AgentEvent);

describe('WebSocketTransport — slow consumer', () => {
    it('keeps sending while the send buffer is below the limit', () => {
        const s = fake(1024);
        const t = new WebSocketTransport(s, { maxBufferedBytes: 4096 });
        t.emit(token('a'));
        expect(s._sent).toHaveLength(1);
        expect(s.close).not.toHaveBeenCalled();
    });

    it('closes the connection (1013) instead of queueing more once the buffer passes the limit', () => {
        const s = fake();
        const t = new WebSocketTransport(s, { maxBufferedBytes: 4096 });
        s.bufferedAmount = 5000;
        t.emit(token('a'));
        expect(s.close).toHaveBeenCalledWith(1013, 'slow consumer');
        expect(s._sent).toHaveLength(0);
        expect(t.isOpen).toBe(false);
        t.emit(token('b')); // nothing more is attempted
        expect(s.close).toHaveBeenCalledTimes(1);
    });

    it('has a default limit of 8 MiB', () => {
        expect(DEFAULT_MAX_BUFFERED_BYTES).toBe(8 * 1024 * 1024);
        const s = fake(DEFAULT_MAX_BUFFERED_BYTES + 1);
        new WebSocketTransport(s).emit(token('a'));
        expect(s.close).toHaveBeenCalled();
    });

    it('a socket that reports no bufferedAmount is treated as empty', () => {
        const s = fake();
        delete (s as { bufferedAmount?: number }).bufferedAmount;
        new WebSocketTransport(s).emit(token('a'));
        expect(s._sent).toHaveLength(1);
    });
});

describe('MonitorBus — slow observer', () => {
    it('skips frames for an observer that is not reading, still serves the others, and counts the drops', () => {
        const bus = new MonitorBus();
        const slow = fake();
        const quick = fake();
        bus.subscribe(slow);
        bus.subscribe(quick);
        slow._sent.length = 0; quick._sent.length = 0;

        slow.bufferedAmount = 2 * 1024 * 1024;
        bus.broadcast('s1', token('x'));
        bus.broadcast('s1', token('y'));

        expect(slow._sent).toHaveLength(0);
        expect(quick._sent).toHaveLength(2);
        expect(bus.droppedFrames).toBe(2);
        expect(slow.close).not.toHaveBeenCalled(); // best-effort: it is not cut off
    });

    it('resumes once the observer drains its buffer', () => {
        const bus = new MonitorBus();
        const o = fake();
        bus.subscribe(o);
        o._sent.length = 0;
        o.bufferedAmount = 2 * 1024 * 1024;
        bus.broadcast('s', token('lost'));
        o.bufferedAmount = 0;
        bus.broadcast('s', token('seen'));
        expect(o._sent).toHaveLength(1);
        expect(o._sent[0]).toContain('seen');
    });
});
