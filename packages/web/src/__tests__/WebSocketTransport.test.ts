import type { WebSocket } from 'ws';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { WebSocketTransport } from '../transport/WebSocketTransport';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeSocket = WebSocket & {
    _sent: string[];
    _trigger: (event: string, data?: unknown) => void;
    readyState: number;
};

function makeSocket(readyState = 1 /* OPEN */): FakeSocket {
    const listeners: Record<string, Array<(data?: unknown) => void>> = {};
    const socket = {
        readyState,
        send:  jest.fn((data: string) => { socket._sent.push(data); }),
        close: jest.fn(),
        on:    jest.fn((event: string, cb: (data?: unknown) => void) => {
            (listeners[event] ??= []).push(cb);
        }),
        _sent: [] as string[],
        _trigger(event: string, data?: unknown) {
            listeners[event]?.forEach(h => h(data));
        },
    };
    return socket as unknown as FakeSocket;
}

function tokenEvent(content: string): AgentEvent {
    return { type: 'token', content } as AgentEvent;
}

function inputFrame(content: string): Buffer {
    return Buffer.from(JSON.stringify({ type: 'input', content }));
}

function approvalFrame(decision: 'approve' | 'approve_all' | 'reject'): Buffer {
    return Buffer.from(JSON.stringify({ type: 'approval', decision }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebSocketTransport', () => {

    // ── constructor ───────────────────────────────────────────────────────────

    describe('constructor', () => {
        it('registers a "message" listener on the socket', () => {
            const socket = makeSocket();
            new WebSocketTransport(socket);
            expect(socket.on).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('registers a "close" listener on the socket', () => {
            const socket = makeSocket();
            new WebSocketTransport(socket);
            expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
        });
    });

    // ── emit() ────────────────────────────────────────────────────────────────

    describe('emit()', () => {
        it('sends the event as JSON to the socket', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            const event  = tokenEvent('hello');
            t.emit(event);
            expect(socket._sent).toHaveLength(1);
            expect(JSON.parse(socket._sent[0])).toEqual(event);
        });

        it('sends multiple events in order', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            t.emit(tokenEvent('a'));
            t.emit(tokenEvent('b'));
            t.emit(tokenEvent('c'));
            expect(socket._sent).toHaveLength(3);
            expect(JSON.parse(socket._sent[2])).toEqual(tokenEvent('c'));
        });

        it('does not send after close()', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            t.close();
            t.emit(tokenEvent('dropped'));
            expect(socket._sent).toHaveLength(0);
        });

        it('does not send after the socket fires its close event', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            socket._trigger('close');
            t.emit(tokenEvent('dropped'));
            expect(socket._sent).toHaveLength(0);
        });

        it('does not throw when socket.send() throws', () => {
            const socket = makeSocket();
            (socket.send as jest.Mock).mockImplementationOnce(() => { throw new Error('write error'); });
            const t = new WebSocketTransport(socket);
            expect(() => t.emit(tokenEvent('x'))).not.toThrow();
        });
    });

    // ── onInput() ─────────────────────────────────────────────────────────────

    describe('onInput()', () => {
        it('invokes the handler when an input frame arrives', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            socket._trigger('message', inputFrame('what is AI?'));
            expect(handler).toHaveBeenCalledWith('what is AI?');
        });

        it('supports multiple input handlers simultaneously', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            const h1     = jest.fn();
            const h2     = jest.fn();
            t.onInput(h1);
            t.onInput(h2);
            socket._trigger('message', inputFrame('ping'));
            expect(h1).toHaveBeenCalledWith('ping');
            expect(h2).toHaveBeenCalledWith('ping');
        });

        it('returns an unsubscribe function that removes the handler', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            const unsub   = t.onInput(handler);
            unsub();
            socket._trigger('message', inputFrame('ignored'));
            expect(handler).not.toHaveBeenCalled();
        });

        it('unsubscribing one handler does not affect others', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            const h1     = jest.fn();
            const h2     = jest.fn();
            const unsub1 = t.onInput(h1);
            t.onInput(h2);
            unsub1();
            socket._trigger('message', inputFrame('hello'));
            expect(h1).not.toHaveBeenCalled();
            expect(h2).toHaveBeenCalledWith('hello');
        });

        it('does not invoke handlers for non-input message types', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            socket._trigger('message', approvalFrame('approve'));
            expect(handler).not.toHaveBeenCalled();
        });

        it('silently ignores malformed (non-JSON) message frames', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            expect(() =>
                socket._trigger('message', Buffer.from('not json {')),
            ).not.toThrow();
            expect(handler).not.toHaveBeenCalled();
        });

        it('does not fire handlers after close()', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            t.close();
            socket._trigger('message', inputFrame('late'));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ── close() ───────────────────────────────────────────────────────────────

    describe('close()', () => {
        it('calls socket.close()', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            t.close();
            expect(socket.close).toHaveBeenCalled();
        });

        it('sets isOpen to false', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(true);
            t.close();
            expect(t.isOpen).toBe(false);
        });

        it('clears all input handlers', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            t.close();
            socket._trigger('message', inputFrame('ghost'));
            expect(handler).not.toHaveBeenCalled();
        });

        it('is idempotent — calling close() twice does not throw', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            t.close();
            expect(() => t.close()).not.toThrow();
        });

        it('does not throw when socket.close() throws', () => {
            const socket = makeSocket();
            (socket.close as jest.Mock).mockImplementationOnce(() => { throw new Error('already closed'); });
            const t = new WebSocketTransport(socket);
            expect(() => t.close()).not.toThrow();
        });
    });

    // ── socket close event ────────────────────────────────────────────────────

    describe('socket close event', () => {
        it('sets the transport to closed when the socket fires close', () => {
            const socket = makeSocket();
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(true);
            socket._trigger('close');
            expect(t.isOpen).toBe(false);
        });

        it('clears input handlers when the socket fires close', () => {
            const socket  = makeSocket();
            const t       = new WebSocketTransport(socket);
            const handler = jest.fn();
            t.onInput(handler);
            socket._trigger('close');
            socket._trigger('message', inputFrame('too late'));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ── isOpen getter ─────────────────────────────────────────────────────────

    describe('isOpen', () => {
        it('is true when not closed and socket.readyState is OPEN (1)', () => {
            const socket = makeSocket(1);
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(true);
        });

        it('is false when socket.readyState is CONNECTING (0)', () => {
            const socket = makeSocket(0);
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(false);
        });

        it('is false when socket.readyState is CLOSING (2)', () => {
            const socket = makeSocket(2);
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(false);
        });

        it('is false when socket.readyState is CLOSED (3)', () => {
            const socket = makeSocket(3);
            const t      = new WebSocketTransport(socket);
            expect(t.isOpen).toBe(false);
        });

        it('is false after close() regardless of socket.readyState', () => {
            const socket = makeSocket(1);
            const t      = new WebSocketTransport(socket);
            t.close();
            expect(t.isOpen).toBe(false);
        });
    });
});
