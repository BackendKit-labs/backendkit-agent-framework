import type { LLMMessage, LLMStreamCallbacks } from '@backendkit-labs/agent-core';
import type { OpenAIChunk, OpenAIClientLike } from '../OpenAICompatibleProvider';
import type { AnthropicClientLike, AnthropicStreamEvent } from '../AnthropicProvider';

export function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
    return Object.assign(new Error(message), { status });
}

export function netError(code = 'ECONNRESET'): Error & { code: string } {
    return Object.assign(new Error(code), { code });
}

/** Async iterable over `items`; an Error item is thrown when reached. */
export async function* iterate<T>(items: Array<T | Error>): AsyncGenerator<T> {
    for (const item of items) {
        if (item instanceof Error) throw item;
        yield item;
    }
}

export const text = (content: string): OpenAIChunk => ({ choices: [{ delta: { content } }] });
export const usage = (prompt: number, completion: number): OpenAIChunk => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } });

/**
 * OpenAI double: each `create` call consumes the next script entry. An Error entry makes `create`
 * itself throw; an array entry is the stream (an Error inside it is thrown mid-stream).
 */
export function openaiClient(script: Array<Error | Array<OpenAIChunk | Error>>) {
    let i = 0;
    const create = jest.fn(async (_params: unknown, _opts?: { signal?: AbortSignal }) => {
        const step = script[Math.min(i++, script.length - 1)];
        if (step instanceof Error) throw step;
        return iterate(step);
    });
    const client: OpenAIClientLike = { chat: { completions: { create } } };
    return { client, create };
}

export interface Recorded {
    chunks: string[];
    tools: Array<{ name: string; args: string; id: string }>;
    metrics: Array<[number, number]>;
    done?: LLMMessage;
    error?: Error;
    callbacks: LLMStreamCallbacks;
}

export function recorder(extra: Partial<LLMStreamCallbacks> = {}): Recorded {
    const r: Recorded = {
        chunks: [], tools: [], metrics: [],
        callbacks: {
            onChunk: (d) => { r.chunks.push(d); },
            onToolCall: (name, args, id) => { r.tools.push({ name, args, id }); },
            onMetrics: (i, o) => { r.metrics.push([i, o]); },
            onDone: (m) => { r.done = m; },
            onError: (e) => { r.error = e; },
            ...extra,
        },
    };
    return r;
}

export const userMsg = (content: string): LLMMessage => ({ role: 'user', content });

// ── Anthropic double ──────────────────────────────────────────────────────────

export const ev = (e: unknown) => e as AnthropicStreamEvent;

/** Each `stream` call consumes the next script entry; an Error entry makes `stream` throw. */
export function anthropicClient(script: Array<Error | Array<AnthropicStreamEvent | Error>>) {
    let i = 0;
    const stream = jest.fn((_params: unknown, _opts?: { signal?: AbortSignal }) => {
        const step = script[Math.min(i++, script.length - 1)];
        if (step instanceof Error) throw step;
        return iterate(step);
    });
    const client: AnthropicClientLike = { messages: { stream } };
    return { client, stream };
}
