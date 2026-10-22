import type { AgentEvent, Transport } from '@backendkit-labs/agent-core';

export interface MockTransport {
    transport: Transport;
    /** Every event emitted so far, in order. */
    events: AgentEvent[];
    /** The events of one type, narrowed. */
    eventsOf<T extends AgentEvent['type']>(type: T): Array<Extract<AgentEvent, { type: T }>>;
    /** Concatenated `token` content: the text the user would have seen streaming. */
    text(): string;
    clear(): void;
}

/** A transport that records what the engine emits and offers small helpers to query it. */
export function mockTransport(): MockTransport {
    const events: AgentEvent[] = [];
    return {
        events,
        transport: {
            emit: (event) => { events.push(event); },
            onInput: () => () => undefined,
            close: () => undefined,
        },
        eventsOf: (type) => events.filter((e): e is Extract<AgentEvent, { type: typeof type }> => e.type === type),
        text: () => events.map(e => (e.type === 'token' ? e.content : '')).join(''),
        clear: () => { events.length = 0; },
    };
}
