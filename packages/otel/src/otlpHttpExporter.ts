import type { Span, SpanExporter } from '@backendkit-labs/agent-core';
import { mapSpan, toSpanId, toTraceId } from './mapping';
import type { OtelAttributes } from './mapping';

export interface OtlpHttpExporterOptions {
    /**
     * Base URL of the collector or backend. Default: `OTEL_EXPORTER_OTLP_ENDPOINT` or
     * `http://localhost:4318`. `/v1/traces` is appended unless the URL already ends with it.
     */
    endpoint?: string;
    /** Extra HTTP headers, e.g. `{ Authorization: 'Basic …' }` for Langfuse or a hosted backend. */
    headers?: Record<string, string>;
    /** Value of the `service.name` resource attribute. Default `agent`. */
    serviceName?: string;
    /** Additional resource attributes (deployment.environment, service.version, …). */
    resourceAttributes?: OtelAttributes;
    /** Spans buffered before a send is triggered. Default 64. */
    batchSize?: number;
    /** Batches allowed to wait for a slow collector before the oldest are dropped (reported via `onError`). Default 32. */
    maxQueuedBatches?: number;
    /** A partial batch is sent after this long. Default 2000 ms. */
    flushIntervalMs?: number;
    /** Request timeout. Default 10000 ms. */
    timeoutMs?: number;
    /** Called when a send fails (the spans of that batch are dropped). Never thrown. */
    onError?: (error: Error) => void;
    /** Override for tests or custom transports. Default: global `fetch`. */
    fetch?: typeof fetch;
}

export type OtlpHttpSpanExporter = SpanExporter & {
    /** Sends everything buffered and resolves when the collector answered. */
    flush(): Promise<void>;
    /** Flushes and stops the timer. Call it on process shutdown. */
    shutdown(): Promise<void>;
};

const KIND = { internal: 1, client: 3 } as const;
const SCOPE = { name: '@backendkit-labs/agent-otel', version: '0.1.0' };

function attrValue(v: string | number | boolean): Record<string, unknown> {
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { boolValue: v };
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

function attributes(attrs: OtelAttributes): Array<{ key: string; value: Record<string, unknown> }> {
    return Object.entries(attrs).map(([key, value]) => ({ key, value: attrValue(value) }));
}

function nanos(d: Date): string {
    return (BigInt(d.getTime()) * 1_000_000n).toString();
}

/** OTLP/JSON form of one span. */
export function toOtlpSpan(span: Span): Record<string, unknown> {
    const m = mapSpan(span);
    return {
        traceId: toTraceId(span.traceId),
        spanId: toSpanId(span.spanId),
        ...(span.parentSpanId ? { parentSpanId: toSpanId(span.parentSpanId) } : {}),
        name: m.name,
        kind: KIND[m.kind],
        startTimeUnixNano: nanos(span.startedAt),
        endTimeUnixNano: nanos(span.endedAt),
        attributes: attributes(m.attributes),
        status: m.isError ? { code: 2, ...(m.errorMessage ? { message: m.errorMessage } : {}) } : { code: 1 },
    };
}

function resolveUrl(endpoint: string): string {
    const base = endpoint.replace(/\/+$/, '');
    return base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;
}

/**
 * Sends agent-core spans to any OTLP/HTTP collector or backend (Jaeger, Tempo, Langfuse, Datadog, the
 * OpenTelemetry Collector…) without the OpenTelemetry SDK. Spans are batched; a failing send never reaches
 * the agent: it is reported through `onError` and that batch is dropped.
 *
 * @example
 * observability: { tracing: { exporter: otlpHttpSpanExporter({ endpoint: 'http://localhost:4318', serviceName: 'support-agent' }) } }
 */
export function otlpHttpSpanExporter(options: OtlpHttpExporterOptions = {}): OtlpHttpSpanExporter {
    const url = resolveUrl(options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318');
    const batchSize = Math.max(1, options.batchSize ?? 64);
    const intervalMs = options.flushIntervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const doFetch = options.fetch ?? globalThis.fetch;
    const resourceAttrs: OtelAttributes = { 'service.name': options.serviceName ?? 'agent', ...(options.resourceAttributes ?? {}) };

    const maxQueuedBatches = Math.max(1, options.maxQueuedBatches ?? 32);

    let queue: Record<string, unknown>[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    // Batches waiting for the collector. Bounded: with a slow or hung collector the oldest are dropped
    // instead of piling up without limit.
    const pending: Record<string, unknown>[][] = [];
    // Sends run one after another so a slow collector never gets overlapping requests.
    let draining: Promise<void> | null = null;

    const send = async (spans: Record<string, unknown>[]): Promise<void> => {
        try {
            const res = await doFetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
                body: JSON.stringify({
                    resourceSpans: [{
                        resource: { attributes: attributes(resourceAttrs) },
                        scopeSpans: [{ scope: SCOPE, spans }],
                    }],
                }),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) throw new Error(`OTLP export failed: HTTP ${res.status}`);
        } catch (err) {
            options.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
    };

    const drain = (): Promise<void> => {
        if (draining) return draining;
        if (pending.length === 0) return Promise.resolve();
        draining = (async () => {
            try {
                while (pending.length > 0) await send(pending.shift()!);
            } finally {
                // Runs in the same tick as the last emptiness check, so a batch queued later starts a new drain.
                draining = null;
            }
        })();
        return draining;
    };

    const flush = (): Promise<void> => {
        if (queue.length > 0) {
            pending.push(queue);
            queue = [];
            while (pending.length > maxQueuedBatches) {
                const dropped = pending.shift()!;
                options.onError?.(new Error(`OTLP export backlog full (${maxQueuedBatches} batches): dropped ${dropped.length} spans`));
            }
        }
        return drain();
    };

    const exporter = ((span: Span): void => {
        queue.push(toOtlpSpan(span));
        if (queue.length >= batchSize) { void flush(); return; }
        if (!timer && intervalMs > 0) {
            timer = setInterval(() => { void flush(); }, intervalMs);
            timer.unref?.();
        }
    }) as OtlpHttpSpanExporter;

    exporter.flush = flush;
    exporter.shutdown = async () => {
        if (timer) { clearInterval(timer); timer = undefined; }
        await flush();
    };
    return exporter;
}
