import { AnthropicProvider } from '../AnthropicProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { anthropicClient, ev, openaiClient, recorder, text, userMsg } from './helpers';
import type { LLMMessage } from '@backendkit-labs/agent-core';

/** SPEC-0001 §6 (ADR-0004): prompt cache, extended thinking, cache usage. */

const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };
const textDelta = (t: string, index = 0) => ev({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } });
const tool = { name: 't', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => '' };
type Params = Record<string, unknown> & { system?: unknown; tools?: Array<Record<string, unknown>>; messages: Array<{ role: string; content: unknown }> };

async function request(opts: Record<string, unknown>, messages: LLMMessage[], tools = [tool]) {
    const { client, stream } = anthropicClient([[textDelta('ok')]]);
    await new AnthropicProvider({ apiKey: 'k', client, ...fast, ...opts }).chat(messages, tools, recorder().callbacks);
    return stream.mock.calls[0][0] as Params;
}

const convo: LLMMessage[] = [
    { role: 'system', content: 'sys one' },
    { role: 'system', content: 'sys two' },
    userMsg('question'),
];

describe('prompt cache modes', () => {
    it('none: system is one string and nothing carries cache_control (as before)', async () => {
        const p = await request({}, convo);
        expect(p.system).toBe('sys one\n\nsys two');
        expect(JSON.stringify(p)).not.toContain('cache_control');
    });

    it('system: separate blocks, cache_control only on the last one', async () => {
        const p = await request({ cache: 'system' }, convo);
        expect(p.system).toEqual([
            { type: 'text', text: 'sys one' },
            { type: 'text', text: 'sys two', cache_control: { type: 'ephemeral' } },
        ]);
        expect(p.tools![0]).not.toHaveProperty('cache_control');
        expect(p.messages[0].content).toBe('question');
    });

    it('system+tools: also marks the last tool definition', async () => {
        const second = { ...tool, name: 't2' };
        const p = await request({ cache: 'system+tools' }, convo, [tool, second]);
        expect(p.tools![0]).not.toHaveProperty('cache_control');
        expect(p.tools![1].cache_control).toEqual({ type: 'ephemeral' });
        expect(p.messages[0].content).toBe('question');
    });

    it('auto: also a moving breakpoint on the last message (string content becomes a block)', async () => {
        const p = await request({ cache: 'auto' }, convo);
        expect(p.messages[0].content).toEqual([{ type: 'text', text: 'question', cache_control: { type: 'ephemeral' } }]);
        expect(p.tools![0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('auto: marks the last tool_result of a tool loop', async () => {
        const p = await request({ cache: 'auto' }, [
            ...convo,
            { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 't', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'x', content: 'result' },
        ]);
        const last = p.messages[p.messages.length - 1].content as Array<Record<string, unknown>>;
        expect(last[last.length - 1]).toMatchObject({ type: 'tool_result', cache_control: { type: 'ephemeral' } });
    });

    it('cacheTtl 1h is sent as ttl', async () => {
        const p = await request({ cache: 'system', cacheTtl: '1h' }, convo);
        expect((p.system as Array<Record<string, unknown>>)[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('no system message: nothing to mark and no system key', async () => {
        const p = await request({ cache: 'system' }, [userMsg('q')], []);
        expect(p).not.toHaveProperty('system');
    });
});

describe('cache usage', () => {
    const usageEvents = (read: number | null, write: number | null) => [
        ev({ type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: read, cache_creation_input_tokens: write } } }),
        textDelta('ok'),
        ev({ type: 'message_delta', usage: { output_tokens: 9 } }),
    ];

    it('reports cache read/write tokens through onMetrics', async () => {
        const { client } = anthropicClient([usageEvents(300, 40)]);
        const calls: unknown[][] = [];
        const r = recorder({ onMetrics: (...a) => { calls.push(a); } });
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [], r.callbacks);
        expect(calls).toEqual([[20, 9, { cacheReadTokens: 300, cacheWriteTokens: 40 }]]);
    });

    it('passes no usage detail when the API reports none', async () => {
        const { client } = anthropicClient([usageEvents(null, null)]);
        const calls: unknown[][] = [];
        const r = recorder({ onMetrics: (...a) => { calls.push(a); } });
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [], r.callbacks);
        expect(calls).toEqual([[20, 9, undefined]]);
    });
});

describe('extended thinking', () => {
    const thinkingTurn = [
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me ' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }),
        ev({ type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'ENC' } }),
        ev({ type: 'content_block_start', index: 2, content_block: { type: 'text' } }),
        textDelta('calling', 2),
        ev({ type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'tu1', name: 't' } }),
        ev({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"a":' } }),
        ev({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '1}' } }),
    ];

    it('sends thinking with budget_tokens and omits temperature', async () => {
        const p = await request({ thinking: { budgetTokens: 2000 }, temperature: 0.3 }, [userMsg('q')], []);
        expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
        expect(p).not.toHaveProperty('temperature');
        expect(p.max_tokens).toBe(8192);
    });

    it('without thinking, temperature is still sent', async () => {
        const p = await request({ temperature: 0.3 }, [userMsg('q')], []);
        expect(p.temperature).toBe(0.3);
        expect(p).not.toHaveProperty('thinking');
    });

    it('streams reasoning to onReasoning and keeps the signed blocks in raw', async () => {
        const { client } = anthropicClient([thinkingTurn]);
        const reasoning: string[] = [];
        const r = recorder({ onReasoning: (d) => { reasoning.push(d); } });
        await new AnthropicProvider({ apiKey: 'k', client, thinking: { budgetTokens: 2000 }, ...fast }).chat([userMsg('q')], [tool], r.callbacks);
        expect(reasoning).toEqual(['let me ', 'think']);
        expect(r.chunks).toEqual(['calling']);
        expect(r.done?.content).toBe('calling');
        expect(r.done?.tool_calls?.[0]).toMatchObject({ id: 'tu1', function: { name: 't', arguments: '{"a":1}' } });
        expect(r.done?.raw).toEqual([
            { type: 'thinking', thinking: 'let me think', signature: 'SIG' },
            { type: 'redacted_thinking', data: 'ENC' },
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'tu1', name: 't', input: { a: 1 } },
        ]);
    });

    it('does not add raw when the turn had no thinking', async () => {
        const { client } = anthropicClient([[textDelta('plain')]]);
        const r = recorder();
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [], r.callbacks);
        expect(r.done).not.toHaveProperty('raw');
    });

    it('the next turn sends the thinking blocks back intact, signature included', async () => {
        const first = anthropicClient([thinkingTurn]);
        const r1 = recorder();
        const provider = new AnthropicProvider({ apiKey: 'k', client: first.client, thinking: { budgetTokens: 2000 }, ...fast });
        await provider.chat([userMsg('q')], [tool], r1.callbacks);

        const second = anthropicClient([[textDelta('done')]]);
        const provider2 = new AnthropicProvider({ apiKey: 'k', client: second.client, thinking: { budgetTokens: 2000 }, ...fast });
        await provider2.chat([
            userMsg('q'),
            r1.done!,
            { role: 'tool', tool_call_id: 'tu1', content: 'result' },
        ], [tool], recorder().callbacks);

        const p = second.stream.mock.calls[0][0] as Params;
        expect(p.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(p.messages[1].content).toEqual(r1.done!.raw);
    });

    it('rejects a budget outside the allowed range with a clear error', () => {
        const make = (budgetTokens: number, maxTokens?: number) =>
            () => new AnthropicProvider({ apiKey: 'k', client: anthropicClient([[]]).client, thinking: { budgetTokens }, maxTokens });
        expect(make(512)).toThrow(/budgetTokens must be an integer >= 1024/);
        expect(make(8192)).toThrow(/< maxTokens \(8192\)/);
        expect(make(5000, 4000)).toThrow(/< maxTokens \(4000\)/);
        expect(make(2000.5)).toThrow(/integer/);
        expect(make(1024)).not.toThrow();
    });
});

describe('raw never reaches other providers', () => {
    it('OpenAICompatibleProvider strips raw from the messages it sends', async () => {
        const { client, create } = openaiClient([[text('ok')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client }).chat([
            userMsg('q'),
            { role: 'assistant', content: 'a', raw: [{ type: 'thinking' }] },
        ], [], recorder().callbacks);
        const [params] = create.mock.calls[0] as [{ messages: Array<Record<string, unknown>> }];
        expect(params.messages[1]).toEqual({ role: 'assistant', content: 'a' });
    });
});
