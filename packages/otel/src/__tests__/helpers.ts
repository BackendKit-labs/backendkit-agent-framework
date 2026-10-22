import type { Span } from '@backendkit-labs/agent-core';

let n = 0;
export function span(over: Partial<Span> & Pick<Span, 'name'>): Span {
    const start = new Date(1_700_000_000_000 + n * 10);
    n++;
    return {
        traceId: 'trace-1',
        spanId: `span-${n}`,
        startedAt: start,
        endedAt: new Date(start.getTime() + 50),
        durationMs: 50,
        status: 'ok',
        tags: {},
        ...over,
    };
}
