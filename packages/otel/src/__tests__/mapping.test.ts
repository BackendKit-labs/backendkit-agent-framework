import { mapSpan, toSpanId, toTraceId } from '../mapping';
import { span } from './helpers';

describe('ids', () => {
    it('produces OTel-shaped, deterministic ids from any input', () => {
        expect(toTraceId('7b1d1c2e-1111-4222-8333-944455556666')).toMatch(/^[0-9a-f]{32}$/);
        expect(toSpanId('7b1d1c2e-1111-4222-8333-944455556666')).toMatch(/^[0-9a-f]{16}$/);
        expect(toSpanId('x')).toBe(toSpanId('x'));
        expect(toSpanId('x')).not.toBe(toSpanId('y'));
        expect(toTraceId('x')).not.toBe(toTraceId('y'));
    });
});

describe('mapSpan', () => {
    it('maps llm_call to a GenAI chat span with usage, provider, model and cost', () => {
        const m = mapSpan(span({
            name: 'llm_call',
            tags: {
                agent_id: 'main', provider: 'deepseek', model: 'deepseek-chat', input_tokens: 100, output_tokens: 20,
                cache_read_tokens: 40, cache_write_tokens: 5, cost_usd: 0.0012, purpose: 'context_summary',
            },
        }));
        expect(m.name).toBe('chat deepseek-chat');
        expect(m.kind).toBe('client');
        expect(m.attributes).toMatchObject({
            'gen_ai.operation.name': 'chat',
            'gen_ai.request.model': 'deepseek-chat',
            'gen_ai.provider.name': 'deepseek',
            'gen_ai.system': 'deepseek',
            'gen_ai.agent.id': 'main',
            'gen_ai.usage.input_tokens': 100,
            'gen_ai.usage.output_tokens': 20,
            'gen_ai.usage.cache_read.input_tokens': 40,
            'gen_ai.usage.cache_creation.input_tokens': 5,
            'bk.cost_usd': 0.0012,
            'bk.llm.purpose': 'context_summary',
        });
    });

    it('names an llm_call without a model "chat unknown"', () => {
        expect(mapSpan(span({ name: 'llm_call', tags: {} })).name).toBe('chat unknown');
    });

    it('maps tool_call to execute_tool', () => {
        const m = mapSpan(span({ name: 'tool_call', status: 'error', tags: { 'tool.name': 'read_file', agent_id: 'coder', success: false } }));
        expect(m.name).toBe('execute_tool read_file');
        expect(m.isError).toBe(true);
        expect(m.attributes).toMatchObject({
            'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'read_file', 'gen_ai.tool.type': 'function',
            'gen_ai.agent.id': 'coder', 'bk.success': false,
        });
    });

    it('exposes the tool outcome (timeout / aborted) as bk.outcome', () => {
        const m = mapSpan(span({ name: 'tool_call', status: 'error', tags: { 'tool.name': 'run_command', success: false, outcome: 'timeout' } }));
        expect(m.attributes).toMatchObject({ 'bk.outcome': 'timeout' });
    });

    it('maps agent_block to invoke_agent, preferring the agent name', () => {
        const m = mapSpan(span({ name: 'agent_block', tags: { agent_id: 'qa', agent_name: 'QA Engineer' } }));
        expect(m.name).toBe('invoke_agent QA Engineer');
        expect(m.attributes).toMatchObject({ 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.id': 'qa', 'gen_ai.agent.name': 'QA Engineer' });
        expect(mapSpan(span({ name: 'agent_block', tags: { agent_id: 'qa' } })).name).toBe('invoke_agent qa');
        expect(mapSpan(span({ name: 'agent_block', tags: {} })).name).toBe('invoke_agent agent');
    });

    it('maps run to agent.run, keeping the original trace id and surfacing the error message', () => {
        const m = mapSpan(span({ name: 'run', status: 'error', tags: { error: 'boom', 'guardrail.pii.redact': true } }));
        expect(m.name).toBe('agent.run');
        expect(m.isError).toBe(true);
        expect(m.errorMessage).toBe('boom');
        expect(m.attributes['bk.trace_id']).toBe('trace-1');
        expect(m.attributes['bk.guardrail.pii.redact']).toBe(true);
        expect(m.attributes).not.toHaveProperty('bk.error');
    });

    it('passes unknown spans through under the vendor prefix', () => {
        const m = mapSpan(span({ name: 'custom', tags: { a: 1 } }));
        expect(m).toMatchObject({ name: 'custom', kind: 'internal', attributes: { 'bk.a': 1 } });
    });

    it('never carries conversation content: only tag values from the span', () => {
        const m = mapSpan(span({ name: 'llm_call', tags: { model: 'm' } }));
        expect(Object.keys(m.attributes).every(k => k.startsWith('gen_ai.') || k.startsWith('bk.'))).toBe(true);
    });
});

describe('mapSpan — tags leave the process only if listed', () => {
    const attrsOf = (name: string, tags: Record<string, string | number | boolean>) => mapSpan(span({ name, tags })).attributes;

    it('drops an unlisted tag on every span kind agent-core produces', () => {
        for (const name of ['run', 'agent_block', 'llm_call', 'tool_call']) {
            const a = attrsOf(name, { prompt_preview: 'secret text', args: '{"password":"x"}' });
            expect(Object.keys(a).join(',')).not.toMatch(/prompt_preview|args/);
        }
    });

    it('keeps what core sets: guardrail markers on the run, success and outcome on a tool call', () => {
        expect(attrsOf('run', { 'guardrail.pii.redact': true, error: 'boom' })).toMatchObject({ 'bk.guardrail.pii.redact': true });
        expect(attrsOf('run', { 'guardrail.pii.redact': true, error: 'boom' })).not.toHaveProperty('bk.error');
        expect(attrsOf('tool_call', { 'tool.name': 'read_file', success: true, outcome: 'ok' })).toMatchObject({ 'bk.success': true, 'bk.outcome': 'ok' });
    });

    it('rejects a lookalike guardrail key with extra segments', () => {
        expect(attrsOf('run', { 'guardrail.a.b.redact': true, 'guardrail.x.unknown': true })).toEqual({ 'bk.trace_id': expect.any(String) });
    });

    it("spans the application creates itself keep passing their tags through", () => {
        expect(attrsOf('checkout', { order_id: 'o1' })).toEqual({ 'bk.order_id': 'o1' });
    });
});
