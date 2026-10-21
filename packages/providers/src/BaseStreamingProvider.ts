import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition, ChatOptions } from '@backendkit-labs/agent-core';
import { withRetry, isTransient } from './retry';

export interface RetryTuning {
    /** Total attempts, first try included. */
    maxAttempts?: number;
    /** First backoff delay. Lower it in tests. */
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
}

export interface ToolCallBuffer { id: string; name: string; args: string }

/**
 * Shared streaming skeleton: retries transient failures with @backendkit-labs/retry, never retries
 * once content reached the caller or the call was aborted, and reports failures through
 * `callbacks.onError` instead of throwing. Subclasses implement `stream`.
 */
export abstract class BaseStreamingProvider implements LLMProvider {
    protected readonly maxAttempts: number;
    protected readonly retryBaseDelayMs: number;
    protected readonly retryMaxDelayMs: number;

    protected constructor(tuning: RetryTuning, defaults: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }) {
        this.maxAttempts = tuning.maxAttempts ?? defaults.maxAttempts;
        this.retryBaseDelayMs = tuning.retryBaseDelayMs ?? defaults.baseDelayMs;
        this.retryMaxDelayMs = tuning.retryMaxDelayMs ?? defaults.maxDelayMs;
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
