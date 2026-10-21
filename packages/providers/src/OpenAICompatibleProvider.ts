import OpenAI from 'openai';
import type { LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';
import { BaseStreamingProvider, type RetryTuning, type ToolCallBuffer } from './BaseStreamingProvider';

/** The slice of the OpenAI SDK the provider uses — inject a double in tests. */
export interface OpenAIClientLike {
    chat: {
        completions: {
            create(params: unknown, options?: { signal?: AbortSignal }): Promise<AsyncIterable<OpenAIChunk>>;
        };
    };
}

export interface OpenAIChunk {
    usage?: { prompt_tokens: number; completion_tokens: number } | null;
    choices: Array<{
        delta?: {
            content?: string | null;
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
    }>;
}

export interface OpenAICompatibleProviderOptions extends RetryTuning {
    apiKey: string;
    /** Omit for api.openai.com. */
    baseUrl?: string;
    model: string;
    /** Default 16384. `null` leaves `max_tokens` out of the request (provider default). */
    maxTokens?: number | null;
    /**
     * Default 0. A function receives the effective model, e.g. for models that only accept
     * temperature 1: `m => m.includes('reasoner') ? 1 : 0`.
     */
    temperature?: number | ((model: string) => number);
    /** @deprecated Use `maxAttempts`. Same meaning as before: total attempts, first try included. */
    maxRetries?: number;
    /**
     * Reasoning ("thinking") toggle for providers that support it (e.g. DeepSeek V4 defaults to
     * 'enabled'). Hidden reasoning tokens count against `maxTokens`, so a small budget can be
     * exhausted with zero visible output and no error. Omit to use the API's own default.
     */
    thinking?: 'enabled' | 'disabled';
    /** Inject a client instead of building one from `apiKey`/`baseUrl`. */
    client?: OpenAIClientLike;
}

export class OpenAICompatibleProvider extends BaseStreamingProvider {
    protected readonly client: OpenAIClientLike;
    protected readonly model: string;
    private readonly maxTokens: number | null;
    private readonly temperature: number | ((model: string) => number);
    private readonly thinking?: 'enabled' | 'disabled';

    constructor(opts: OpenAICompatibleProviderOptions, defaults = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 16_000 }) {
        super({ ...opts, maxAttempts: opts.maxAttempts ?? opts.maxRetries }, defaults);
        this.client = opts.client
            ?? (new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0 }) as unknown as OpenAIClientLike);
        this.model = opts.model;
        this.maxTokens = opts.maxTokens === undefined ? 16384 : opts.maxTokens;
        this.temperature = opts.temperature ?? 0;
        this.thinking = opts.thinking;
    }

    protected async stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void> {
        const oaiTools = tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        const model = callbacks.model ?? this.model;
        const temperature = typeof this.temperature === 'function' ? this.temperature(model) : this.temperature;

        const stream = await this.client.chat.completions.create({
            model,
            messages,
            tools: oaiTools.length > 0 ? oaiTools : undefined,
            tool_choice: oaiTools.length > 0 ? 'auto' : undefined,
            ...(this.maxTokens !== null ? { max_tokens: this.maxTokens } : {}),
            temperature,
            stream: true,
            stream_options: { include_usage: true },
            // Not a standard OpenAI field: extension for OpenAI-compatible reasoning models.
            ...(this.thinking ? { thinking: { type: this.thinking } } : {}),
        }, { signal: callbacks.signal });

        let content = '';
        const buffers = new Map<number, ToolCallBuffer>();

        for await (const chunk of stream) {
            // With include_usage the usage arrives in the final chunk.
            if (chunk.usage) callbacks.onMetrics?.(chunk.usage.prompt_tokens, chunk.usage.completion_tokens);

            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                content += delta.content;
                callbacks.onChunk?.(delta.content);
            }

            for (const tc of delta.tool_calls ?? []) {
                if (!buffers.has(tc.index)) buffers.set(tc.index, { id: tc.id ?? '', name: '', args: '' });
                const buf = buffers.get(tc.index)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name += tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
            }
        }

        this.finish(callbacks, content, buffers);
    }
}
