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
