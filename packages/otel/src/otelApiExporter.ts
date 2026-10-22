import type { Span, SpanExporter } from '@backendkit-labs/agent-core';
import type { Context, Span as OtelSpan, Tracer as OtelTracer } from '@opentelemetry/api';
import { mapSpan } from './mapping';

export interface OtelApiExporterOptions {
    /** Tracer to create spans with. Default: `trace.getTracer('@backendkit-labs/agent-core')`. */
    tracer?: OtelTracer;
    /**
     * Spans held while waiting for their root to end. Past this, everything pending is flushed with
     * orphans promoted to roots. Default 5000.
     */
    maxBufferedSpans?: number;
}

export type OtelApiSpanExporter = SpanExporter & {
    /** Emits spans still waiting for a root (e.g. a run that never finished). */
    flush(): void;
};

type Api = typeof import('@opentelemetry/api');

function loadApi(): Api {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('@opentelemetry/api') as Api;
    } catch {
        throw new Error(
            'otelApiSpanExporter needs "@opentelemetry/api" (npm i @opentelemetry/api) and an OpenTelemetry SDK ' +
            'registered in the process. Use otlpHttpSpanExporter() to export without the SDK.',
        );
    }
}

/**
 * Re-creates agent-core spans through the OpenTelemetry API, so they flow to whatever SDK, processor and
 * exporter the host application already configured.
 *
 * The OpenTelemetry API cannot choose a span's id, so a child must be created from its parent's real
 * OTel span. agent-core exports spans when they end (children first), therefore this adapter holds a
 * trace's spans until its root `run` span ends and then creates the tree parents-first, keeping the
 * original start and end times. Use `otlpHttpSpanExporter` when you do not run the SDK.
 */
export function otelApiSpanExporter(options: OtelApiExporterOptions = {}): OtelApiSpanExporter {
    const api = loadApi();
    const tracer = options.tracer ?? api.trace.getTracer('@backendkit-labs/agent-core');
    const maxBuffered = options.maxBufferedSpans ?? 5000;
    const pending = new Map<string, Span[]>();   // by core traceId
    let buffered = 0;

    const create = (span: Span, parent: OtelSpan | undefined): OtelSpan => {
        const mapped = mapSpan(span);
        const ctx: Context = parent ? api.trace.setSpan(api.ROOT_CONTEXT, parent) : api.ROOT_CONTEXT;
        const otel = tracer.startSpan(mapped.name, {
            kind: mapped.kind === 'client' ? api.SpanKind.CLIENT : api.SpanKind.INTERNAL,
            startTime: span.startedAt,
            attributes: mapped.attributes,
        }, ctx);
        if (mapped.isError) {
            otel.setStatus({ code: api.SpanStatusCode.ERROR, ...(mapped.errorMessage ? { message: mapped.errorMessage } : {}) });
        }
        otel.end(span.endedAt);
        return otel;
    };

    // Creates `roots` and all their descendants, parents before children, and drops them from the buffer.
    const emit = (traceId: string, rootIds: Set<string>): void => {
        const list = pending.get(traceId) ?? [];
        const children = new Map<string, Span[]>();
        for (const s of list) {
            if (s.parentSpanId) children.set(s.parentSpanId, [...(children.get(s.parentSpanId) ?? []), s]);
        }
        const used = new Set<Span>();
        const walk = (span: Span, parent: OtelSpan | undefined): void => {
            used.add(span);
            const otel = create(span, parent);
            for (const child of (children.get(span.spanId) ?? []).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
                walk(child, otel);
            }
        };
        for (const root of list.filter(s => rootIds.has(s.spanId))) walk(root, undefined);
        const left = list.filter(s => !used.has(s));
        buffered -= used.size;
        if (left.length > 0) pending.set(traceId, left); else pending.delete(traceId);
    };

    const flush = (): void => {
        for (const [traceId, list] of [...pending]) {
            const ids = new Set(list.map(s => s.spanId));
            // Whatever has no pending parent starts a tree: real roots and spans whose parent never arrived.
            emit(traceId, new Set(list.filter(s => !s.parentSpanId || !ids.has(s.parentSpanId)).map(s => s.spanId)));
        }
    };

    const exporter = ((span: Span): void => {
        pending.set(span.traceId, [...(pending.get(span.traceId) ?? []), span]);
        buffered++;
        if (!span.parentSpanId) emit(span.traceId, new Set([span.spanId]));
        else if (buffered > maxBuffered) flush();
    }) as OtelApiSpanExporter;

    exporter.flush = flush;
    return exporter;
}
