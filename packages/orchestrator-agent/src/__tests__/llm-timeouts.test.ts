import type { LLMProvider, LLMStreamCallbacks } from '@backendkit-labs/agent-core';
import { callLLM, DEFAULT_LLM_TIMEOUT_MS, llmTimeoutMs } from '../provider.js';
import { DEFAULT_SUBTASK_TIMEOUT_MS, subtaskTimeoutMs } from '../subtask-queue.js';

type Chat = (cb: LLMStreamCallbacks) => Promise<void> | void;
const provider = (chat: Chat): LLMProvider => ({ chat: async (_m, _t, cb) => chat(cb) }) as LLMProvider;

describe('callLLM', () => {
    it('returns the streamed text', async () => {
        const out = await callLLM(provider(cb => { cb.onChunk?.('he'); cb.onChunk?.('llo'); cb.onDone({ role: 'assistant', content: 'hello' }); }), 's', 'u');
        expect(out).toBe('hello');
    });

    it('a provider that never answers fails after the timeout, and its request is cancelled', async () => {
        let signal: AbortSignal | undefined;
        const stalled = provider(cb => { signal = cb.signal; return new Promise<void>(() => { /* never settles */ }); });
        await expect(callLLM(stalled, 's', 'u', { timeoutMs: 40 })).rejects.toThrow(/timed out after 40ms/);
        expect(signal?.aborted).toBe(true);
    });

    it('a stream that stops halfway fails instead of waiting forever', async () => {
        const halfway = provider(cb => { cb.onChunk?.('partial answer'); /* and then silence */ });
        await expect(callLLM(halfway, 's', 'u', { timeoutMs: 40 })).rejects.toThrow(/timed out/);
    });

    it('a chat() that rejects without calling onError fails the call at once', async () => {
        const rejecting = provider(async () => { throw new Error('connection reset'); });
        const started = Date.now();
        await expect(callLLM(rejecting, 's', 'u', { timeoutMs: 5_000 })).rejects.toThrow('connection reset');
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('an onError from the provider is the error of the call', async () => {
        const failing = provider(cb => cb.onError(new Error('rate limited')));
        await expect(callLLM(failing, 's', 'u')).rejects.toThrow('rate limited');
    });

    it('does not time out a call that finishes in time, and leaves no timer behind', async () => {
        jest.useFakeTimers();
        try {
            const done = callLLM(provider(cb => { cb.onChunk?.('ok'); cb.onDone({ role: 'assistant', content: 'ok' }); }), 's', 'u', { timeoutMs: 1_000 });
            await expect(done).resolves.toBe('ok');
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('timeouts from the environment', () => {
    it('LLM: default, override, and nonsense falls back to the default', () => {
        expect(llmTimeoutMs({})).toBe(DEFAULT_LLM_TIMEOUT_MS);
        expect(llmTimeoutMs({ ORCHESTRATOR_LLM_TIMEOUT_MS: '60000' })).toBe(60_000);
        for (const bad of ['', 'abc', '0', '-5', 'NaN']) {
            expect(llmTimeoutMs({ ORCHESTRATOR_LLM_TIMEOUT_MS: bad })).toBe(DEFAULT_LLM_TIMEOUT_MS);
        }
    });

    it('subtask wait: default, override, and nonsense falls back to the default', () => {
        expect(subtaskTimeoutMs({})).toBe(DEFAULT_SUBTASK_TIMEOUT_MS);
        expect(subtaskTimeoutMs({ ORCHESTRATOR_SUBTASK_TIMEOUT_MS: '120000' })).toBe(120_000);
        for (const bad of ['', 'abc', '0', '-5']) {
            expect(subtaskTimeoutMs({ ORCHESTRATOR_SUBTASK_TIMEOUT_MS: bad })).toBe(DEFAULT_SUBTASK_TIMEOUT_MS);
        }
    });
});
