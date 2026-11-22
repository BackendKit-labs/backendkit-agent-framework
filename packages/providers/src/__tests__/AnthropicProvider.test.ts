import { AnthropicProvider, type AnthropicClientLike, type AnthropicStreamEvent } from '../AnthropicProvider';
import { httpError, iterate, recorder, userMsg } from './helpers';

const ev = (e: unknown) => e as AnthropicStreamEvent;
const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };

function anthropicClient(script: Array<Error | Array<AnthropicStreamEvent | Error>>) {
    let i = 0;
    const stream = jest.fn((_params: unknown, _opts?: { signal?: AbortSignal }) => {
        const step = script[Math.min(i++, script.length - 1)];
        if (step instanceof Error) throw step;
        return iterate(step);
    });
    const client: AnthropicClientLike = { messages: { stream } };
    return { client, stream };
}

const textBlock = (t: string) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });

describe('AnthropicProvider', () => {
    it('streams text, reports usage once and finishes', async () => {
        const { client } = anthropicClient([[
            ev({ type: 'message_start', message: { usage: { input_tokens: 12 } } }),
            textBlock('Hel'), textBlock('lo'),
            ev({ type: 'message_delta', usage: { output_tokens: 7 } }),
        ]]);
        const r = recorder();
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.chunks).toEqual(['Hel', 'lo']);
        expect(r.metrics).toEqual([[12, 7]]);
        expect(r.done?.content).toBe('Hello');
    });

    it('assembles tool_use blocks from json deltas in index order', async () => {
        const { client } = anthropicClient([[
            ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'b', name: 'second' } }),
            ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'a', name: 'first' } }),
            ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"p":' } }),
            ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } }),
            ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        ]]);
        const r = recorder();
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('go')], [], r.callbacks);
        expect(r.tools).toEqual([
            { name: 'first', args: '{"p":1}', id: 'a' },
            { name: 'second', args: '{}', id: 'b' },
        ]);
        expect(r.done?.content).toBeNull();
    });

    it('joins all system messages, groups consecutive tool results and forwards model/signal/tools', async () => {
        const { client, stream } = anthropicClient([[textBlock('ok')]]);
        const callerAbort = new AbortController(); const signal = callerAbort.signal;
        const tool = { name: 't', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => '' };
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([
            { role: 'system', content: 'one' },
            { role: 'system', content: 'two' },
            userMsg('q'),
            { role: 'assistant', content: 'calling', tool_calls: [
                { id: 'x', type: 'function', function: { name: 't', arguments: '{"a":1}' } },
                { id: 'y', type: 'function', function: { name: 't', arguments: '' } },
            ] },
            { role: 'tool', tool_call_id: 'x', content: 'rx' },
            { role: 'tool', tool_call_id: 'y', content: 'ry' },
        ], [tool], { ...recorder().callbacks, model: 'claude-x', signal });
        const [params, opts] = stream.mock.calls[0] as [Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> }, { signal?: AbortSignal }];
        expect(params).toMatchObject({ model: 'claude-x', system: 'one\n\ntwo', max_tokens: 8192, temperature: 0 });
        expect(opts.signal).toBeInstanceOf(AbortSignal); void callerAbort;   // a guarded signal (follows the caller's; see streamGuards.test.ts)
        expect((params.tools as unknown[])).toHaveLength(1);
        expect(params.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(params.messages[1].content).toEqual([
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'x', name: 't', input: { a: 1 } },
            { type: 'tool_use', id: 'y', name: 't', input: {} },
        ]);
        expect(params.messages[2].content).toEqual([
            { type: 'tool_result', tool_use_id: 'x', content: 'rx' },
            { type: 'tool_result', tool_use_id: 'y', content: 'ry' },
        ]);
    });

    it('omits system and tools when there are none', async () => {
        const { client, stream } = anthropicClient([[textBlock('ok')]]);
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('hi')], [], recorder().callbacks);
        const [params] = stream.mock.calls[0] as [Record<string, unknown>];
        expect(params).not.toHaveProperty('system');
        expect(params).not.toHaveProperty('tools');
    });

    it('retries transient errors, then reports the original error when exhausted', async () => {
        const ok = anthropicClient([httpError(500), [textBlock('ok')]]);
        const r1 = recorder();
        await new AnthropicProvider({ apiKey: 'k', client: ok.client, ...fast }).chat([userMsg('hi')], [], r1.callbacks);
        expect(ok.stream).toHaveBeenCalledTimes(2);
        expect(r1.error).toBeUndefined();

        const boom = httpError(429);
        const bad = anthropicClient([boom]);
        const r2 = recorder();
        await new AnthropicProvider({ apiKey: 'k', client: bad.client, maxAttempts: 3, ...fast }).chat([userMsg('hi')], [], r2.callbacks);
        expect(bad.stream).toHaveBeenCalledTimes(3);
        expect(r2.error).toBe(boom);
    });

    it('does not retry client errors or a failure after content', async () => {
        const a = anthropicClient([httpError(401)]);
        await new AnthropicProvider({ apiKey: 'k', client: a.client, ...fast }).chat([userMsg('hi')], [], recorder().callbacks);
        expect(a.stream).toHaveBeenCalledTimes(1);

        const b = anthropicClient([[textBlock('part'), httpError(500)]]);
        const r = recorder();
        await new AnthropicProvider({ apiKey: 'k', client: b.client, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(b.stream).toHaveBeenCalledTimes(1);
        expect(r.error).toBeDefined();
    });
});
