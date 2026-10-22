import { otlpHttpSpanExporter, toOtlpSpan } from '../otlpHttpExporter';
import { toSpanId, toTraceId } from '../mapping';
import { span } from './helpers';

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 200) {
    const calls: Call[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: status >= 200 && status < 300, status } as Response;
    }) as unknown as typeof fetch;
    return { calls, impl };
}

const bodyOf = (c: Call) => JSON.parse(String(c.init.body));
const spansOf = (c: Call) => bodyOf(c).resourceSpans[0].scopeSpans[0].spans as Array<Record<string, any>>;

describe('toOtlpSpan', () => {
    it('writes ids, times in nanoseconds, kind, attributes and status', () => {
        const s = span({ name: 'llm_call', parentSpanId: 'p1', tags: { model: 'm', input_tokens: 3, cost_usd: 0.5, ok: true } });
        const o = toOtlpSpan(s) as Record<string, any>;
        expect(o.traceId).toBe(toTraceId(s.traceId));
        expect(o.spanId).toBe(toSpanId(s.spanId));
        expect(o.parentSpanId).toBe(toSpanId('p1'));
        expect(o.name).toBe('chat m');
        expect(o.kind).toBe(3);
        expect(o.startTimeUnixNano).toBe((BigInt(s.startedAt.getTime()) * 1_000_000n).toString());
        expect(o.endTimeUnixNano).toBe((BigInt(s.endedAt.getTime()) * 1_000_000n).toString());
        expect(o.status).toEqual({ code: 1 });
        const attrs = Object.fromEntries(o.attributes.map((a: any) => [a.key, a.value]));
        expect(attrs['gen_ai.usage.input_tokens']).toEqual({ intValue: '3' });
        expect(attrs['bk.cost_usd']).toEqual({ doubleValue: 0.5 });
        expect(attrs['bk.ok']).toEqual({ boolValue: true });
        expect(attrs['gen_ai.request.model']).toEqual({ stringValue: 'm' });
    });

    it('omits parentSpanId on a root and reports errors with their message', () => {
        const o = toOtlpSpan(span({ name: 'run', status: 'error', tags: { error: 'boom' } })) as Record<string, any>;
        expect(o).not.toHaveProperty('parentSpanId');
        expect(o.status).toEqual({ code: 2, message: 'boom' });
        expect((toOtlpSpan(span({ name: 'tool_call', status: 'error' })) as any).status).toEqual({ code: 2 });
    });

    it('keeps parent and child ids consistent', () => {
        const parent = span({ name: 'agent_block' });
        const child = span({ name: 'tool_call', parentSpanId: parent.spanId });
        expect((toOtlpSpan(child) as any).parentSpanId).toBe((toOtlpSpan(parent) as any).spanId);
    });
});

describe('otlpHttpSpanExporter', () => {
    it('batches by size and posts OTLP/JSON to /v1/traces with resource attributes and headers', async () => {
        const { calls, impl } = fakeFetch();
        const exp = otlpHttpSpanExporter({
            endpoint: 'http://collector:4318/', fetch: impl, batchSize: 2, flushIntervalMs: 0,
            serviceName: 'support-agent', resourceAttributes: { 'deployment.environment': 'prod' },
            headers: { Authorization: 'Basic abc' },
        });
        exp(span({ name: 'run' }));
        expect(calls).toHaveLength(0);
        exp(span({ name: 'tool_call' }));
        await exp.flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://collector:4318/v1/traces');
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Basic abc');
        expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe('application/json');
        const body = bodyOf(calls[0]);
        const res = Object.fromEntries(body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, a.value.stringValue]));
        expect(res).toEqual({ 'service.name': 'support-agent', 'deployment.environment': 'prod' });
        expect(body.resourceSpans[0].scopeSpans[0].scope.name).toBe('@backendkit-labs/agent-otel');
        expect(spansOf(calls[0])).toHaveLength(2);
    });

    it('does not append /v1/traces twice and uses the env endpoint by default', async () => {
        const a = fakeFetch();
        const e1 = otlpHttpSpanExporter({ endpoint: 'http://x/v1/traces', fetch: a.impl, flushIntervalMs: 0 });
        e1(span({ name: 'run' })); await e1.flush();
        expect(a.calls[0].url).toBe('http://x/v1/traces');

        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://from-env:4318';
        try {
            const b = fakeFetch();
            const e2 = otlpHttpSpanExporter({ fetch: b.impl, flushIntervalMs: 0 });
            e2(span({ name: 'run' })); await e2.flush();
            expect(b.calls[0].url).toBe('http://from-env:4318/v1/traces');
        } finally {
            delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        }
    });

    it('flush sends a partial batch and does nothing when empty', async () => {
        const { calls, impl } = fakeFetch();
        const exp = otlpHttpSpanExporter({ fetch: impl, flushIntervalMs: 0 });
        await exp.flush();
        expect(calls).toHaveLength(0);
        exp(span({ name: 'run' }));
        await exp.flush();
        expect(calls).toHaveLength(1);
        await exp.flush();
        expect(calls).toHaveLength(1);
    });

    it('sends a partial batch on the interval timer, and shutdown stops it', async () => {
        jest.useFakeTimers();
        try {
            const { calls, impl } = fakeFetch();
            const exp = otlpHttpSpanExporter({ fetch: impl, flushIntervalMs: 1000 });
            exp(span({ name: 'run' }));
            expect(calls).toHaveLength(0);
            await jest.advanceTimersByTimeAsync(1000);
            expect(calls).toHaveLength(1);
            exp(span({ name: 'run' }));
            await exp.shutdown();
            expect(calls).toHaveLength(2);
            expect(calls).toHaveLength(2);
            await jest.advanceTimersByTimeAsync(5000);
            expect(calls).toHaveLength(2);        // nothing buffered and no timer running: silence
            exp(span({ name: 'run' }));           // a later span simply restarts the timer
            await jest.advanceTimersByTimeAsync(1000);
            expect(calls).toHaveLength(3);
            await exp.shutdown();
        } finally {
            jest.useRealTimers();
        }
    });

    it('reports HTTP and network failures through onError without throwing', async () => {
        const errors: Error[] = [];
        const bad = fakeFetch(500);
        const e1 = otlpHttpSpanExporter({ fetch: bad.impl, flushIntervalMs: 0, onError: (e) => errors.push(e) });
        e1(span({ name: 'run' }));
        await expect(e1.flush()).resolves.toBeUndefined();
        expect(errors[0].message).toContain('HTTP 500');

        const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
        const e2 = otlpHttpSpanExporter({ fetch: boom, flushIntervalMs: 0, onError: (e) => errors.push(e) });
        e2(span({ name: 'run' }));
        await expect(e2.flush()).resolves.toBeUndefined();
        expect(errors[1].message).toBe('ECONNREFUSED');

        // no onError: still silent
        const e3 = otlpHttpSpanExporter({ fetch: boom, flushIntervalMs: 0 });
        e3(span({ name: 'run' }));
        await expect(e3.flush()).resolves.toBeUndefined();
    });

    it('serializes sends: a second batch waits for the first', async () => {
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const impl = (async (_u: string, init: RequestInit) => {
            const n = JSON.parse(String(init.body)).resourceSpans[0].scopeSpans[0].spans.length;
            order.push(`start${n}`);
            if (n === 1) await gate;
            order.push(`end${n}`);
            return { ok: true, status: 200 } as Response;
        }) as unknown as typeof fetch;
        const exp = otlpHttpSpanExporter({ fetch: impl, flushIntervalMs: 0, batchSize: 1 });
        exp(span({ name: 'run' }));
        exp(span({ name: 'run' }));
        exp(span({ name: 'run' }));
        await Promise.resolve();
        release();
        await exp.flush();
        expect(order.join(',')).toBe('start1,end1,start1,end1,start1,end1');
    });
});
