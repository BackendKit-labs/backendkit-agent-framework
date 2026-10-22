import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Context, SpanOptions } from '@opentelemetry/api';
import { otelApiSpanExporter } from '../otelApiExporter';
import { span } from './helpers';

interface Made {
    name: string;
    options: SpanOptions;
    parent: unknown;
    ended?: Date;
    status?: { code: number; message?: string };
    api: Record<string, unknown>;
}

function fakeTracer() {
    const made: Made[] = [];
    const tracer = {
        startSpan(name: string, options: SpanOptions, ctx: Context) {
            const m: Made = { name, options, parent: trace.getSpan(ctx), api: {} };
            const fake = {
                setStatus(s: { code: number; message?: string }) { m.status = s; },
                end(t: Date) { m.ended = t; },
                spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1 }),
            };
            m.api = fake;
            made.push(m);
            return fake;
        },
    };
    return { made, tracer: tracer as never };
}

/** A realistic run: run → agent_block → (llm_call, tool_call), exported children-first like the Tracer does. */
function runSpans(traceId = 't1') {
    const run = span({ name: 'run', traceId });
    const block = span({ name: 'agent_block', traceId, parentSpanId: run.spanId, tags: { agent_id: 'main', agent_name: 'Main' } });
    const llm = span({ name: 'llm_call', traceId, parentSpanId: block.spanId, tags: { model: 'm', input_tokens: 5 } });
    const tool = span({ name: 'tool_call', traceId, parentSpanId: block.spanId, tags: { 'tool.name': 'read' } });
    return { run, block, llm, tool, exportOrder: [llm, tool, block, run] };
}

describe('otelApiSpanExporter', () => {
    it('holds children until the run ends, then creates the tree parents-first', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const s = runSpans();

        exp(s.llm); exp(s.tool); exp(s.block);
        expect(made).toHaveLength(0);               // nothing yet: the root is still open
        exp(s.run);

        expect(made.map(m => m.name)).toEqual(['agent.run', 'invoke_agent Main', 'chat m', 'execute_tool read']);
        const [run, block, llm, tool] = made;
        expect(run.parent).toBeUndefined();
        expect(block.parent).toBe(run.api);
        expect(llm.parent).toBe(block.api);
        expect(tool.parent).toBe(block.api);
    });

    it('keeps the original start and end times and the span kind', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const s = runSpans();
        s.exportOrder.forEach(exp);

        const llm = made.find(m => m.name === 'chat m')!;
        expect(llm.options.startTime).toEqual(s.llm.startedAt);
        expect(llm.ended).toEqual(s.llm.endedAt);
        expect(llm.options.kind).toBe(SpanKind.CLIENT);
        expect(made.find(m => m.name === 'agent.run')!.options.kind).toBe(SpanKind.INTERNAL);
        expect(llm.options.attributes).toMatchObject({ 'gen_ai.request.model': 'm', 'gen_ai.usage.input_tokens': 5 });
    });

    it('sets ERROR status with the message on failed spans only', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const run = span({ name: 'run', status: 'error', tags: { error: 'boom' } });
        const ok = span({ name: 'agent_block', parentSpanId: run.spanId });
        exp(ok); exp(run);
        expect(made.find(m => m.name === 'agent.run')!.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' });
        expect(made.find(m => m.name.startsWith('invoke_agent'))!.status).toBeUndefined();
    });

    it('keeps traces apart', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const a = runSpans('A');
        const b = runSpans('B');
        exp(a.llm); exp(b.llm); exp(a.tool); exp(a.block); exp(b.tool); exp(b.block);
        exp(b.run);
        expect(made).toHaveLength(4);                // only B's tree
        exp(a.run);
        expect(made).toHaveLength(8);
    });

    it('flush promotes spans whose parent never arrived to roots, and empties the buffer', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const s = runSpans();
        exp(s.llm); exp(s.tool); exp(s.block);       // the run never ends (crash)
        exp.flush();
        expect(made.map(m => m.name)).toEqual(['invoke_agent Main', 'chat m', 'execute_tool read']);
        expect(made[0].parent).toBeUndefined();
        expect(made[1].parent).toBe(made[0].api);
        exp.flush();
        expect(made).toHaveLength(3);
    });

    it('flushes by itself past maxBufferedSpans', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer, maxBufferedSpans: 2 });
        const s = runSpans();
        exp(s.llm); exp(s.tool);
        expect(made).toHaveLength(0);
        exp(s.block);                                // third span exceeds the cap
        expect(made.length).toBe(3);
    });

    it('orders siblings by start time', () => {
        const { made, tracer } = fakeTracer();
        const exp = otelApiSpanExporter({ tracer });
        const run = span({ name: 'run' });
        const late = span({ name: 'tool_call', parentSpanId: run.spanId, tags: { 'tool.name': 'late' } });
        const early = span({ name: 'tool_call', parentSpanId: run.spanId, tags: { 'tool.name': 'early' } });
        early.startedAt = new Date(late.startedAt.getTime() - 100);
        exp(late); exp(early); exp(run);
        expect(made.slice(1).map(m => m.name)).toEqual(['execute_tool early', 'execute_tool late']);
    });

    it('defaults to the global OpenTelemetry tracer when none is given', () => {
        const exp = otelApiSpanExporter();            // no SDK registered: the API hands back no-op spans
        const s = runSpans();
        expect(() => s.exportOrder.forEach(exp)).not.toThrow();
    });
});
