import { randomUUID } from 'crypto';
import type { Span, SpanExporter, TracingConfig } from './types';

interface ActiveSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    startedAt: Date;
    tags: Record<string, string | number | boolean>;
    end(status: 'ok' | 'error'): void;
    setTag(key: string, value: string | number | boolean): void;
}

export class Tracer {
    private readonly exporter: SpanExporter;
    private currentTraceId: string | null = null;

    constructor(config: TracingConfig) {
        this.exporter = resolveExporter(config.exporter);
    }

    /** Start a new root span (new traceId). */
    startRootSpan(name: string, tags?: Record<string, string | number | boolean>): ActiveSpan {
        this.currentTraceId = randomUUID();
        return this.createSpan(name, this.currentTraceId, undefined, tags);
    }

    /** Start a child span under the current trace. */
    startSpan(name: string, parentSpanId?: string, tags?: Record<string, string | number | boolean>): ActiveSpan {
        const traceId = this.currentTraceId ?? randomUUID();
        return this.createSpan(name, traceId, parentSpanId, tags);
    }

    /**
     * Exports a span that already finished, with its real start and end (epoch ms). Used for calls whose
     * events arrive after the fact, e.g. tools of a parallel wave, whose events are flushed in call order.
     */
    recordSpan(span: {
        name: string;
        parentSpanId?: string;
        tags?: Record<string, string | number | boolean>;
        startedAt: number;
        endedAt: number;
        status: 'ok' | 'error';
    }): void {
        const startedAt = new Date(span.startedAt);
        const endedAt = new Date(Math.max(span.startedAt, span.endedAt));
        this.exporter({
            traceId: this.currentTraceId ?? randomUUID(),
            spanId: randomUUID(),
            parentSpanId: span.parentSpanId,
            name: span.name,
            startedAt,
            endedAt,
            durationMs: endedAt.getTime() - startedAt.getTime(),
            status: span.status,
            tags: { ...(span.tags ?? {}) },
        });
    }

    private createSpan(
        name: string,
        traceId: string,
        parentSpanId?: string,
        tags: Record<string, string | number | boolean> = {},
    ): ActiveSpan {
        const spanId = randomUUID();
        const startedAt = new Date();
        const mutableTags = { ...tags };
        const exporter = this.exporter;

        return {
            traceId,
            spanId,
            parentSpanId,
            name,
            startedAt,
            tags: mutableTags,
            setTag(key, value) { mutableTags[key] = value; },
            end(status) {
                const endedAt = new Date();
                const span: Span = {
                    traceId,
                    spanId,
                    parentSpanId,
                    name,
                    startedAt,
                    endedAt,
                    durationMs: endedAt.getTime() - startedAt.getTime(),
                    status,
                    tags: { ...mutableTags },
                };
                exporter(span);
            },
        };
    }
}

function resolveExporter(exporter: TracingConfig['exporter']): SpanExporter {
    if (!exporter || exporter === 'noop') return () => undefined;
    if (exporter === 'console') {
        return (span) => {
            const ms = span.durationMs.toString().padStart(5);
            const tags = Object.entries(span.tags).map(([k, v]) => `${k}=${v}`).join(' ');
            console.log(`[TRACE] ${ms}ms ${span.status.toUpperCase().padEnd(5)} ${span.name}${tags ? ` | ${tags}` : ''}`);
        };
    }
    return exporter;
}
