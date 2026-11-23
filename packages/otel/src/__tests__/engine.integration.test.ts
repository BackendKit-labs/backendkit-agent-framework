import { createBaseEngine, defineTool, z } from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider } from '@backendkit-labs/agent-testkit';
import { otlpHttpSpanExporter } from '../otlpHttpExporter';

/** A real engine, a scripted model, spans exported through OTLP to a fake collector. */
describe('agent-core engine → OTLP', () => {
    const agent: AgentProfile = {
        id: 'main', name: 'Main', icon: 'M', description: 'x', systemPrompt: 'x',
        allowedTools: ['echo'], delegatesTo: [], model: 'tiny',
    };
    const { transport } = mockTransport();

    it('exports run → agent_block → llm_call / tool_call with consistent ids', async () => {
        const provider = scriptedProvider([
            { tool_calls: [{ id: 'c1', name: 'echo', args: { x: 1 } }], metrics: { inputTokens: 30, outputTokens: 5 } },
            { content: 'done', metrics: { inputTokens: 40, outputTokens: 8 } },
        ]);
        const posted: Array<Record<string, any>> = [];
        const exporter = otlpHttpSpanExporter({
            serviceName: 'it', flushIntervalMs: 0,
            fetch: (async (_u: string, init: RequestInit) => { posted.push(JSON.parse(String(init.body))); return { ok: true, status: 200 } as Response; }) as unknown as typeof fetch,
        });
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: provider }, defaultProvider: 'mock', agents: [agent], transport, iterationMode: 'auto',
            tools: [defineTool({ name: 'echo', description: 'echo', input: z.object({ x: z.number() }), execute: async ({ x }) => `x=${x}` })],
            observability: { tracing: { exporter } },
        });
        await engine.run('hello');
        await exporter.flush();

        const spans = posted.flatMap(b => b.resourceSpans[0].scopeSpans[0].spans) as Array<Record<string, any>>;
        const byName = (prefix: string) => spans.filter(s => s.name.startsWith(prefix));
        const run = byName('agent.run')[0];
        const block = byName('invoke_agent')[0];
        const llm = byName('chat');
        const tools = byName('execute_tool');

        expect(spans).toHaveLength(5);         // run, agent_block, 2 × llm_call, 1 × tool_call
        expect(llm).toHaveLength(2);
        expect(tools).toHaveLength(1);
        expect(run.parentSpanId).toBeUndefined();
        expect(block.parentSpanId).toBe(run.spanId);
        for (const s of [...llm, ...tools]) expect(s.parentSpanId).toBe(block.spanId);
        expect(new Set(spans.map(s => s.traceId)).size).toBe(1);
        expect(llm[0].name).toBe('chat tiny');
        const attr = (s: any, k: string) => s.attributes.find((a: any) => a.key === k)?.value;
        expect(attr(llm[1], 'gen_ai.usage.input_tokens')).toEqual({ intValue: '40' });
        expect(attr(tools[0], 'gen_ai.tool.name')).toEqual({ stringValue: 'echo' });
        expect(JSON.stringify(spans)).not.toContain('hello');   // conversation content never leaves the process
    });
});
