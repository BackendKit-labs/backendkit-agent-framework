import type { AgentEvent, Transport, Unsubscribe } from '@backendkit-labs/agent-core';

/**
 * A transport with no outbound socket.
 *
 * Used by TriggerBus for autonomous (cron/webhook) agent runs where there is
 * no human on the other end.  Events are buffered in memory so callers can
 * inspect the full run after completion.
 */
export class HeadlessTransport implements Transport {
    private readonly _events: AgentEvent[] = [];
    private _closed = false;

    emit(event: AgentEvent): void {
        if (this._closed) return;
        this._events.push(event);
    }

    onInput(_handler: (input: string) => void): Unsubscribe {
        // Headless transports never receive human input mid-run.
        return () => { /* no-op */ };
    }

    close(): void {
        this._closed = true;
    }

    /** All events emitted during the run, in order. */
    getEvents(): AgentEvent[] {
        return [...this._events];
    }

    /** Concatenated text output (all 'token' events). */
    getOutput(): string {
        return this._events
            .filter((e): e is AgentEvent & { type: 'token'; content: string } =>
                e.type === 'token' && 'content' in e)
            .map(e => e.content)
            .join('');
    }

    get isClosed(): boolean {
        return this._closed;
    }
}
