import Anthropic from '@anthropic-ai/sdk';
import type { LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';
import { BaseStreamingProvider, type RetryTuning, type ToolCallBuffer } from './BaseStreamingProvider';

/** The slice of the Anthropic SDK the provider uses — inject a double in tests. */
export interface AnthropicClientLike {
    messages: {
        stream(params: unknown, options?: { signal?: AbortSignal }): AsyncIterable<AnthropicStreamEvent>;
    };
}

export type AnthropicStreamEvent = Anthropic.MessageStreamEvent;

export interface AnthropicProviderOptions extends RetryTuning {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** @deprecated Use `maxAttempts`. Same meaning as before: total attempts, first try included. */
    maxRetries?: number;
    /** Inject a client instead of building one from `apiKey`. */
    client?: AnthropicClientLike;
}

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContent = Anthropic.ContentBlockParam;

// ── Fix #14: concatenate all system messages ──────────────────────────────────
function toAnthropicMessages(messages: LLMMessage[]): { system: string | undefined; messages: AnthropicMessage[] } {
    const systemParts: string[] = [];
    const result: AnthropicMessage[] = [];

    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];

        if (msg.role === 'system') {
            if (msg.content) systemParts.push(msg.content);
            i++;
            continue;
        }

        if (msg.role === 'user') {
            result.push({ role: 'user', content: msg.content ?? '' });
            i++;
            continue;
        }

        if (msg.role === 'assistant') {
            const content: AnthropicContent[] = [];
            if (msg.content) content.push({ type: 'text', text: msg.content });
            for (const tc of msg.tool_calls ?? []) {
                content.push({
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.function.name,
                    input: JSON.parse(tc.function.arguments || '{}'),
                });
            }
            result.push({ role: 'assistant', content });
            i++;
            continue;
        }

        if (msg.role === 'tool') {
            // Consecutive tool results → single user message with tool_result blocks
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            while (i < messages.length && messages[i].role === 'tool') {
                const t = messages[i];
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: t.tool_call_id ?? '',
                    content: t.content ?? '',
                });
                i++;
            }
            result.push({ role: 'user', content: toolResults });
            continue;
        }

        i++;
    }

    return {
        system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        messages: result,
    };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class AnthropicProvider extends BaseStreamingProvider {
    private readonly client: AnthropicClientLike;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;

    constructor(opts: AnthropicProviderOptions) {
        super({ ...opts, maxAttempts: opts.maxAttempts ?? opts.maxRetries }, { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 16_000 });
        this.client = opts.client
            ?? (new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) as unknown as AnthropicClientLike); // retries live in the base
        this.model = opts.model ?? 'claude-sonnet-4-6';
        this.maxTokens = opts.maxTokens ?? 8192;
        this.temperature = opts.temperature ?? 0.0;
    }

    protected async stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void> {
        const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
        const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool['input_schema'],
        }));

        const stream = this.client.messages.stream({
            model: callbacks.model ?? this.model,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            ...(system ? { system } : {}),
            messages: anthropicMessages,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        }, { signal: callbacks.signal });

        let content = '';
        const buffers = new Map<number, ToolCallBuffer>();
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const event of stream) {
            if (event.type === 'message_start') {
                inputTokens = event.message.usage.input_tokens;
            } else if (event.type === 'message_delta') {
                outputTokens = event.usage.output_tokens;
            } else if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    buffers.set(event.index, { id: event.content_block.id, name: event.content_block.name, args: '' });
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    content += event.delta.text;
                    callbacks.onChunk?.(event.delta.text);
                } else if (event.delta.type === 'input_json_delta') {
                    const buf = buffers.get(event.index);
                    if (buf) buf.args += event.delta.partial_json;
                }
            }
        }

        if (inputTokens > 0 || outputTokens > 0) callbacks.onMetrics?.(inputTokens, outputTokens);

        this.finish(callbacks, content, buffers);
    }
}
