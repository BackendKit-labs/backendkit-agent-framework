/** Audit 2026-11: a stream that goes quiet is cut, and an answer cut by the output limit says so. */
import { OpenAICompatibleProvider, type OpenAIChunk, type OpenAIClientLike } from '../OpenAICompatibleProvider';
import { TRUNCATED_NOTE } from '../BaseStreamingProvider';
import { recorder, text, userMsg } from './helpers';

const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };

/** A stream that sends `first` and then nothing, and never closes, until the signal it was given aborts. */
function stallingClient(first: OpenAIChunk[], attempts: Array<'stall' | 'ok'> = ['stall']) {
    let call = 0;
    const create = jest.fn(async (_p: unknown, opts?: { signal?: AbortSignal }) => {
        const mode = attempts[Math.min(call++, attempts.length - 1)];
        async function* gen(): AsyncGenerator<OpenAIChunk> {
            for (const c of first) yield c;
            if (mode === 'ok') return;
            await new Promise<void>((_res, rej) => opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' }))));
        }
        return gen();
    });
    const client: OpenAIClientLike = { chat: { completions: { create } } };
    return { client, create };
}

describe('stream idle timeout', () => {
    it('a stream that sends nothing is cut and reported, not waited for forever', async () => {
        const { client } = stallingClient([], ['stall']);
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, streamIdleTimeoutMs: 40, maxAttempts: 1, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.error?.message).toMatch(/sent nothing for 40ms/);
        expect(r.done).toBeUndefined();
    });

    it('before any output it is retried like a network failure', async () => {
        const calls: string[] = [];
        let n = 0;
        const flaky: OpenAIClientLike = { chat: { completions: { create: async (_p, opts) => {
            calls.push(`attempt ${++n}`);
            if (n === 1) return (async function* (): AsyncGenerator<OpenAIChunk> { await new Promise<void>((_r, rej) => opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })))); })();
            return (async function* (): AsyncGenerator<OpenAIChunk> { yield text('hello'); })();
        } } } };
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client: flaky, streamIdleTimeoutMs: 40, maxAttempts: 2, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(calls).toEqual(['attempt 1', 'attempt 2']);
        expect(r.done?.content).toBe('hello');
    });

    it('after output reached the caller it is NOT retried (it would pay and show twice)', async () => {
        const { client, create } = stallingClient([text('partial')], ['stall']);
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, streamIdleTimeoutMs: 40, maxAttempts: 3, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(1);
        expect(r.error?.message).toMatch(/sent nothing/);
    });

    it('0 turns the guard off', async () => {
        const { client } = stallingClient([text('fine')], ['ok']);
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, streamIdleTimeoutMs: 0, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.done?.content).toBe('fine');
    });

    it('the caller\'s own abort still aborts', async () => {
        const { client } = stallingClient([], ['stall']);
        const ac = new AbortController();
        const r = recorder();
        const pending = new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, streamIdleTimeoutMs: 0, maxAttempts: 1, ...fast }).chat([userMsg('hi')], [], { ...r.callbacks, signal: ac.signal });
        setTimeout(() => ac.abort(), 20);
        await pending;
        expect(r.error).toBeDefined();
    });
});

describe('an answer cut by the output limit', () => {
    const chunkWithFinish = (reason: string, delta: OpenAIChunk['choices'][0]['delta'] = {}): OpenAIChunk => ({ choices: [{ delta, finish_reason: reason }] });

    it('text: delivered, but marked as cut', async () => {
        const client: OpenAIClientLike = { chat: { completions: { create: async () => (async function* () { yield text('The answer is'); yield chunkWithFinish('length'); })() } } };
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.done?.content).toBe(`The answer is${TRUNCATED_NOTE}`);
        expect(r.chunks.join('')).toContain('output limit was reached');
    });

    it('a tool call cut in the middle is an error, never a call with half its arguments', async () => {
        const client: OpenAIClientLike = { chat: { completions: { create: async () => (async function* () {
            yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'pay', arguments: '{"amount": 1' } }] } }] } as OpenAIChunk;
            yield chunkWithFinish('length');
        })() } } };
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, maxAttempts: 1, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.error?.message).toMatch(/middle of a tool call/);
        expect(r.tools).toEqual([]);
    });

    it('a normal stop is untouched', async () => {
        const client: OpenAIClientLike = { chat: { completions: { create: async () => (async function* () { yield text('done'); yield chunkWithFinish('stop'); })() } } };
        const r = recorder();
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast }).chat([userMsg('hi')], [], r.callbacks);
        expect(r.done?.content).toBe('done');
    });
});
