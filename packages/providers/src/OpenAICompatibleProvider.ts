import OpenAI from 'openai';
import type { LLMMessage, LLMStreamCallbacks, ToolDefinition, ChatOptions, StructuredOutputSupport } from '@backendkit-labs/agent-core';
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
    /**
     * Send `thinking: disabled` on calls that force a tool (`toolChoice` 'required' or a named tool)
     * when `thinking` was not set explicitly. DeepSeek V4 thinks by default and answers 400 to forced
     * tool choices in that mode. Off by default (not every endpoint accepts the `thinking` field);
     * on in `DeepSeekProvider`.
     */
    disableThinkingForForcedTools?: boolean;
    /**
     * How the backend handles `ChatOptions.responseFormat`. `native`: `response_format: json_schema`
     * (default). `json_object`: only valid JSON is guaranteed, the schema must travel in the prompt
     * (`generateObject` does that). `none`: the option is ignored.
     */
    structuredOutput?: StructuredOutputSupport;
    /** Inject a client instead of building one from `apiKey`/`baseUrl`. */
    client?: OpenAIClientLike;
}

/** OpenAI strict mode needs every property required and no extra properties, at every level. */
function isStrictCompatible(schema: unknown): boolean {
    if (!schema || typeof schema !== 'object') return true;
    const s = schema as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
    if (s.type === 'object' && s.properties) {
        const required = new Set(s.required ?? []);
        if (s.additionalProperties !== false) return false;
        if (!Object.keys(s.properties).every(k => required.has(k))) return false;
        return Object.values(s.properties).every(isStrictCompatible);
    }
    if (s.type === 'array') return isStrictCompatible(s.items);
    return true;
}

function toolChoiceFor(choice: NonNullable<ChatOptions['toolChoice']>): unknown {
    return typeof choice === 'string' ? choice : { type: 'function', function: { name: choice.name } };
}

export class OpenAICompatibleProvider extends BaseStreamingProvider {
    protected readonly client: OpenAIClientLike;
    protected readonly model: string;
    private readonly maxTokens: number | null;
    private readonly temperature: number | ((model: string) => number);
    private readonly thinking?: 'enabled' | 'disabled';
    private readonly disableThinkingForForcedTools: boolean;
    readonly capabilities: { structuredOutput: StructuredOutputSupport };

    constructor(opts: OpenAICompatibleProviderOptions, defaults = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 16_000 }) {
        super({ ...opts, maxAttempts: opts.maxAttempts ?? opts.maxRetries }, defaults);
        this.client = opts.client
            ?? (new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0 }) as unknown as OpenAIClientLike);
        this.model = opts.model;
        this.maxTokens = opts.maxTokens === undefined ? 16384 : opts.maxTokens;
        this.temperature = opts.temperature ?? 0;
        this.thinking = opts.thinking;
        this.disableThinkingForForcedTools = opts.disableThinkingForForcedTools ?? false;
        this.capabilities = { structuredOutput: opts.structuredOutput ?? 'native' };
    }

    protected async stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        const oaiTools = tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        const model = callbacks.model ?? this.model;
        const temperature = typeof this.temperature === 'function' ? this.temperature(model) : this.temperature;

        const stream = await this.client.chat.completions.create({
            model,
            // `raw` is another provider's payload (e.g. Anthropic thinking blocks): never send it.
            messages: messages.map(({ raw: _raw, ...m }) => m),
            tools: oaiTools.length > 0 ? oaiTools : undefined,
            tool_choice: oaiTools.length > 0 ? (options?.toolChoice ? toolChoiceFor(options.toolChoice) : 'auto') : undefined,
            ...this.responseFormat(options),
            ...(this.maxTokens !== null ? { max_tokens: this.maxTokens } : {}),
            temperature,
            stream: true,
            stream_options: { include_usage: true },
            // Not a standard OpenAI field: extension for OpenAI-compatible reasoning models.
            ...(this.thinkingFor(options) ? { thinking: { type: this.thinkingFor(options) } } : {}),
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

    /** Explicit `thinking` wins; otherwise off for forced tool choices when the preset asks for it. */
    private thinkingFor(options?: ChatOptions): 'enabled' | 'disabled' | undefined {
        if (this.thinking) return this.thinking;
        const choice = options?.toolChoice;
        const forced = choice !== undefined && choice !== 'auto' && choice !== 'none';
        return this.disableThinkingForForcedTools && forced ? 'disabled' : undefined;
    }

    private responseFormat(options?: ChatOptions): { response_format?: unknown } {
        const rf = options?.responseFormat;
        if (!rf) return {};
        switch (this.capabilities.structuredOutput) {
            case 'native':
                return {
                    response_format: {
                        type: 'json_schema',
                        // Optional fields cannot satisfy strict mode: relax it instead of getting a 400.
                        json_schema: { name: rf.name, schema: rf.schema, strict: rf.strict !== false && isStrictCompatible(rf.schema) },
                    },
                };
            case 'json_object': return { response_format: { type: 'json_object' } };
            default: return {};
        }
    }
}
