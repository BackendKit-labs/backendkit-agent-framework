import type { AgentEvent } from '@backendkit-labs/agent-core';
import { HeadlessTransport } from '../transport/HeadlessTransport';

function tokenEvent(content: string): AgentEvent {
    return { type: 'token', content } as AgentEvent;
}

function toolEvent(name: string): AgentEvent {
    return { type: 'tool_call', name } as AgentEvent;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HeadlessTransport', () => {

    // ── emit() ────────────────────────────────────────────────────────────────

    describe('emit()', () => {
        it('buffers events in order', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('a'));
            t.emit(tokenEvent('b'));
            t.emit(toolEvent('search'));

            const events = t.getEvents();
            expect(events).toHaveLength(3);
            expect(events[0]).toEqual(tokenEvent('a'));
            expect(events[1]).toEqual(tokenEvent('b'));
            expect(events[2]).toEqual(toolEvent('search'));
        });

        it('does not buffer events after close()', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('before'));
            t.close();
            t.emit(tokenEvent('after'));

            expect(t.getEvents()).toHaveLength(1);
            expect(t.getEvents()[0]).toEqual(tokenEvent('before'));
        });

        it('accepts any AgentEvent shape', () => {
            const t = new HeadlessTransport();
            const events: AgentEvent[] = [
                { type: 'token',     content: 'hi'    } as AgentEvent,
                { type: 'tool_call', name: 'search'   } as AgentEvent,
                { type: 'tool_result', name: 'search', success: true } as AgentEvent,
                { type: 'done'                         } as AgentEvent,
            ];
            events.forEach(e => t.emit(e));
            expect(t.getEvents()).toHaveLength(4);
        });
    });

    // ── getEvents() ───────────────────────────────────────────────────────────

    describe('getEvents()', () => {
        it('returns an empty array when nothing was emitted', () => {
            expect(new HeadlessTransport().getEvents()).toEqual([]);
        });

        it('returns a copy — mutating the returned array does not affect internal state', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('x'));
            const first = t.getEvents();
            first.pop();
            expect(t.getEvents()).toHaveLength(1);
        });
    });

    // ── getOutput() ───────────────────────────────────────────────────────────

    describe('getOutput()', () => {
        it('returns an empty string when no events were emitted', () => {
            expect(new HeadlessTransport().getOutput()).toBe('');
        });

        it('concatenates content from all token events in order', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('Hello'));
            t.emit(tokenEvent(', '));
            t.emit(tokenEvent('world'));
            expect(t.getOutput()).toBe('Hello, world');
        });

        it('ignores non-token events', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('start'));
            t.emit(toolEvent('search'));
            t.emit({ type: 'done' } as AgentEvent);
            t.emit(tokenEvent('end'));
            expect(t.getOutput()).toBe('startend');
        });

        it('returns empty string when only non-token events were emitted', () => {
            const t = new HeadlessTransport();
            t.emit(toolEvent('exec'));
            t.emit({ type: 'done' } as AgentEvent);
            expect(t.getOutput()).toBe('');
        });

        it('reflects the final output even after close()', () => {
            const t = new HeadlessTransport();
            t.emit(tokenEvent('done'));
            t.close();
            expect(t.getOutput()).toBe('done');
        });
    });

    // ── onInput() ─────────────────────────────────────────────────────────────

    describe('onInput()', () => {
        it('returns an unsubscribe function without throwing', () => {
            const t = new HeadlessTransport();
            expect(() => t.onInput(() => {})).not.toThrow();
        });

        it('the returned unsubscribe is callable without throwing', () => {
            const t      = new HeadlessTransport();
            const unsub  = t.onInput(() => {});
            expect(() => unsub()).not.toThrow();
        });

        it('never invokes the handler (headless transports receive no input)', async () => {
            const t       = new HeadlessTransport();
            const handler = jest.fn();
            t.onInput(handler);
            // Give potential async paths time to fire
            await new Promise(r => setImmediate(r));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ── close() ───────────────────────────────────────────────────────────────

    describe('close()', () => {
        it('sets isClosed to true', () => {
            const t = new HeadlessTransport();
            expect(t.isClosed).toBe(false);
            t.close();
            expect(t.isClosed).toBe(true);
        });

        it('is idempotent — calling close() twice does not throw', () => {
            const t = new HeadlessTransport();
            t.close();
            expect(() => t.close()).not.toThrow();
            expect(t.isClosed).toBe(true);
        });
    });

    // ── isClosed getter ───────────────────────────────────────────────────────

    describe('isClosed', () => {
        it('is false on a fresh transport', () => {
            expect(new HeadlessTransport().isClosed).toBe(false);
        });

        it('is true after close()', () => {
            const t = new HeadlessTransport();
            t.close();
            expect(t.isClosed).toBe(true);
        });
    });
});
