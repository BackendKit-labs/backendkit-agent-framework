import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition, ChatOptions } from '@backendkit-labs/agent-core';
import { withRetry, isTransient } from './retry';

export interface RetryTuning {
    /** Total attempts, first try included. */
    maxAttempts?: number;
    /** First backoff delay. Lower it in tests. */
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    /**
     * Milliseconds a stream may go without a single event before it is cut and treated as a network failure (retried while
     * nothing reached the caller). A server that stops sending without closing the connection would otherwise hold the turn
     * until someone aborts it. Default 120000; 0 turns it off.
     */
    streamIdleTimeoutMs?: number;
}

/** A stream that went quiet. Named like the SDKs' connection timeout so it is classed as a network error (and retried before any output). */
export class StreamIdleError extends Error {
    override readonly name = 'APIConnectionTimeoutError';
    constructor(ms: number) { super(`the stream sent nothing for ${ms}ms and was cut`); }
}

/** Added to an answer the model did not finish (output limit reached), so nobody takes a cut text for a complete one. */
export const TRUNCATED_NOTE = '\n\n[The response was cut: the output limit was reached.]';

export interface ToolCallBuffer { id: string; name: string; args: string }

/**
 * Shared streaming skeleton: retries transient failures with @backendkit-labs/retry, never retries
 * once content or reasoning reached the caller or the call was aborted, and reports failures through
 * `callbacks.onError` instead of throwing. Subclasses implement `stream`.
 */
export abstract class BaseStreamingProvider implements LLMProvider {
    protected readonly maxAttempts: number;
    protected readonly retryBaseDelayMs: number;
    protected readonly retryMaxDelayMs: number;
    protected readonly streamIdleTimeoutMs: number;

    protected constructor(tuning: RetryTuning, defaults: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }) {
        this.maxAttempts = tuning.maxAttempts ?? defaults.maxAttempts;
        this.retryBaseDelayMs = tuning.retryBaseDelayMs ?? defaults.baseDelayMs;
        this.retryMaxDelayMs = tuning.retryMaxDelayMs ?? defaults.maxDelayMs;
        this.streamIdleTimeoutMs = tuning.streamIdleTimeoutMs ?? 120_000;
    }

    /**
     * One guard per attempt: `signal` goes to the SDK call (it also follows the caller's), `watch` wraps the event stream and
     * re-arms the timer on every event, `idled()` says whether the guard is what cut the call. Call `stop()` when done.
     */
    protected idleGuard(parent?: AbortSignal): { signal: AbortSignal; watch<T>(it: AsyncIterable<T>): AsyncGenerator<T>; idled(): boolean; stop(): void } {
        const controller = new AbortController();
        const ms = this.streamIdleTimeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idle = false;
        const onParent = () => controller.abort(parent?.reason);
        if (parent) { if (parent.aborted) controller.abort(parent.reason); else parent.addEventListener('abort', onParent, { once: true }); }
        const arm = () => {
            clearTimeout(timer);
            if (ms > 0) timer = setTimeout(() => { idle = true; controller.abort(new StreamIdleError(ms)); }, ms);
        };
        const stop = () => { clearTimeout(timer); parent?.removeEventListener('abort', onParent); };
        arm();      // the wait for the first byte counts too
        async function* watch<T>(it: AsyncIterable<T>): AsyncGenerator<T> {
            try { for await (const x of it) { arm(); yield x; } } finally { stop(); }
        }
        return { signal: controller.signal, watch, idled: () => idle, stop };
    }

    async chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        let contentEmitted = false;
        try {
            await withRetry(
                () => this.stream(messages, tools, {
                    ...callbacks,
                    onChunk: (delta) => {
                        contentEmitted = true;
                        callbacks.onChunk?.(delta);
                    },
                    // Reasoning is billed and shown like content: a retry after it would pay for it twice.
                    onReasoning: (delta) => {
                        contentEmitted = true;
                        callbacks.onReasoning?.(delta);
                    },
                }, options),
                {
                    maxAttempts: this.maxAttempts,
                    baseDelayMs: this.retryBaseDelayMs,
                    maxDelayMs: this.retryMaxDelayMs,
                    // Never retry mid-stream: the caller already saw part of the answer.
                    shouldRetry: (err) => !contentEmitted && this.isRetryable(err),
                    signal: callbacks.signal,
                },
            );
        } catch (err) {
            callbacks.onError(this.toError(err));
        }
    }

    /** One attempt. Throw to signal failure; the base decides whether to retry. */
    protected abstract stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void>;

    /** Default: 429, 5xx and network errors. */
    protected isRetryable(err: unknown): boolean { return isTransient(err); }

    /** Error handed to `onError`. Override to add provider-specific guidance. */
    protected toError(err: unknown): Error { return err instanceof Error ? err : new Error(String(err)); }

    /** Emits the assembled tool calls and the final message. `extra.raw` rides along on the message. */
    protected finish(
        callbacks: LLMStreamCallbacks,
        content: string,
        buffers: Map<number, ToolCallBuffer>,
        extra?: { raw?: unknown },
    ): void {
        const toolCalls = Array.from(buffers.entries())
            .sort(([a], [b]) => a - b)
            .map(([, buf]) => ({
                id: buf.id,
                type: 'function' as const,
                function: { name: buf.name, arguments: buf.args },
            }));

        for (const tc of toolCalls) callbacks.onToolCall?.(tc.function.name, tc.function.arguments, tc.id);

        callbacks.onDone({
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            ...(extra?.raw !== undefined ? { raw: extra.raw } : {}),
        });
    }
}
