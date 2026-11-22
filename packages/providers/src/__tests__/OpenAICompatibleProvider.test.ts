import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { DeepSeekProvider } from '../DeepSeekProvider';
import { httpError, netError, openaiClient, recorder, text, usage, userMsg } from './helpers';

const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };
const make = (client: ReturnType<typeof openaiClient>['client'], extra = {}) =>
    new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast, ...extra });

describe('OpenAICompatibleProvider streaming', () => {
    it('emits chunks, reports usage and finishes with the assembled message', async () => {
        const { client } = openaiClient([[text('Hel'), text('lo'), usage(10, 5)]]);
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], r.callbacks);
        expect(r.chunks).toEqual(['Hel', 'lo']);
        expect(r.metrics).toEqual([[10, 5]]);
        expect(r.done).toEqual({ role: 'assistant', content: 'Hello', tool_calls: undefined });
        expect(r.error).toBeUndefined();
    });

    it('assembles tool calls by index, in index order, concatenating fragments', async () => {
        const { client } = openaiClient([[
            { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{"x"' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'fir', arguments: '{}' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'st' } }, { index: 1, function: { arguments: ':1}' } }] } }] },
        ]]);
        const r = recorder();
        await make(client).chat([userMsg('go')], [], r.callbacks);
        expect(r.tools).toEqual([
            { name: 'first', args: '{}', id: 'a' },
            { name: 'second', args: '{"x":1}', id: 'b' },
        ]);
        expect(r.done?.content).toBeNull();
        expect(r.done?.tool_calls?.map(t => t.id)).toEqual(['a', 'b']);
    });

    it('always requests usage and forwards model, signal and tools', async () => {
        const { client, create } = openaiClient([[text('ok')]]);
        const callerAbort = new AbortController(); const signal = callerAbort.signal;
        const tool = { name: 't', description: 'd', parameters: { type: 'object' }, execute: async () => '' };
        await make(client).chat([userMsg('hi')], [tool], { ...recorder().callbacks, model: 'override', signal });
        const [params, opts] = create.mock.calls[0] as [Record<string, unknown>, { signal?: AbortSignal }];
        expect(params).toMatchObject({
            model: 'override', stream: true, stream_options: { include_usage: true },
            max_tokens: 16384, temperature: 0, tool_choice: 'auto',
        });
        expect((params.tools as unknown[])).toHaveLength(1);
        expect(opts.signal).toBeInstanceOf(AbortSignal); void callerAbort;   // a guarded signal (follows the caller's; see streamGuards.test.ts)
    });

    it('omits tools when there are none and max_tokens when maxTokens is null', async () => {
        const { client, create } = openaiClient([[text('ok')]]);
        await make(client, { maxTokens: null }).chat([userMsg('hi')], [], recorder().callbacks);
        const [params] = create.mock.calls[0] as [Record<string, unknown>];
        expect(params.tools).toBeUndefined();
        expect(params.tool_choice).toBeUndefined();
        expect(params).not.toHaveProperty('max_tokens');
    });

    it('derives temperature from a function of the effective model, and passes thinking through', async () => {
        const { client, create } = openaiClient([[text('a')], [text('b')]]);
        const p = make(client, { temperature: (m: string) => (m.includes('reasoner') ? 1 : 0), thinking: 'disabled' });
        await p.chat([userMsg('x')], [], { ...recorder().callbacks, model: 'deepseek-reasoner' });
        await p.chat([userMsg('x')], [], recorder().callbacks);
        const [first] = create.mock.calls[0] as [Record<string, unknown>];
        const [second] = create.mock.calls[1] as [Record<string, unknown>];
        expect(first.temperature).toBe(1);
        expect(second.temperature).toBe(0);
        expect(first.thinking).toEqual({ type: 'disabled' });
    });
});

describe('OpenAICompatibleProvider retries', () => {
    it('retries 429 and 5xx then succeeds, without reporting an error', async () => {
        const { client, create } = openaiClient([httpError(429), httpError(503), [text('ok')]]);
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(3);
        expect(r.error).toBeUndefined();
        expect(r.chunks).toEqual(['ok']);
    });

    it('retries network errors', async () => {
        const { client, create } = openaiClient([netError('ECONNRESET'), [text('ok')]]);
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(2);
        expect(r.done).toBeDefined();
    });

    it('gives up after maxAttempts and reports the original error through onError', async () => {
        const boom = httpError(500);
        const { client, create } = openaiClient([boom]);
        const r = recorder();
        await make(client, { maxAttempts: 4 }).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(4);
        expect(r.error).toBe(boom);
    });

    it('treats the deprecated maxRetries as total attempts', async () => {
        const { client, create } = openaiClient([httpError(500)]);
        await make(client, { maxRetries: 2 }).chat([userMsg('hi')], [], recorder().callbacks);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('does not retry client errors', async () => {
        const { client, create } = openaiClient([httpError(400)]);
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(1);
        expect(r.error?.message).toBe('HTTP 400');
    });

    it('does not retry once content was emitted', async () => {
        const { client, create } = openaiClient([[text('part'), httpError(500)]]);
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(1);
        expect(r.chunks).toEqual(['part']);
        expect(r.error).toBeDefined();
        expect(r.done).toBeUndefined();
    });

    it('does not retry after an abort, even for a retryable error', async () => {
        const ctrl = new AbortController();
        const { client, create } = openaiClient([httpError(503)]);
        create.mockImplementationOnce(async () => { ctrl.abort(); throw httpError(503); });
        const r = recorder();
        await make(client).chat([userMsg('hi')], [], { ...r.callbacks, signal: ctrl.signal });
        expect(create).toHaveBeenCalledTimes(1);
        expect(r.error).toBeDefined();
    });

    it('never throws: failures go to onError', async () => {
        const { client } = openaiClient([new Error('weird')]);
        const r = recorder();
        await expect(make(client).chat([userMsg('hi')], [], r.callbacks)).resolves.toBeUndefined();
        expect(r.error?.message).toBe('weird');
    });
});

describe('DeepSeekProvider', () => {
    it('applies its defaults and forwards the retry options (maxRetries used to be dropped)', async () => {
        const { client, create } = openaiClient([httpError(500)]);
        const p = new DeepSeekProvider({ apiKey: 'k', client, maxAttempts: 2, ...fast });
        await p.chat([userMsg('hi')], [], recorder().callbacks);
        expect(create).toHaveBeenCalledTimes(2);
        expect((create.mock.calls[0] as [Record<string, unknown>])[0].model).toBe('deepseek-v4-flash');
    });
});
