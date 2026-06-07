import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';

export interface AnthropicProviderOptions {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Max retry attempts on transient errors (429, 5xx). Default: 3. */
    maxRetries?: number;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRetryable(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        return status === 429 || status >= 500;
    }
    return false;
}

function backoffMs(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 16_000);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Provider ──────────────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
    private readonly client: Anthropic;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;
    private readonly maxRetries: number;

    constructor(opts: AnthropicProviderOptions) {
        this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }); // we handle retries ourselves
        this.model = opts.model ?? 'claude-sonnet-4-6';
        this.maxTokens = opts.maxTokens ?? 8192;
        this.temperature = opts.temperature ?? 0.0;
        this.maxRetries = opts.maxRetries ?? 3;
    }

    async chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void> {
        const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
        const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool['input_schema'],
        }));

        let attempt = 0;
        let contentEmitted = false;

        while (attempt < this.maxRetries) {
            attempt++;
            try {
                await this.stream(
                    { system, anthropicMessages, anthropicTools },
                    {
                        ...callbacks,
                        onChunk: (delta) => {
                            contentEmitted = true;
                            callbacks.onChunk?.(delta);
                        },
                    },
                );
                return;
            } catch (err) {
                // Never retry mid-stream — content was already emitted to the caller
                if (contentEmitted || !isRetryable(err) || attempt >= this.maxRetries) {
                    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                await sleep(backoffMs(attempt));
            }
        }
    }

    private async stream(
        params: {
            system: string | undefined;
            anthropicMessages: AnthropicMessage[];
            anthropicTools: Anthropic.Tool[];
        },
        callbacks: LLMStreamCallbacks,
    ): Promise<void> {
        const stream = this.client.messages.stream({
            model: callbacks.model ?? this.model,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            ...(params.system ? { system: params.system } : {}),
            messages: params.anthropicMessages,
            ...(params.anthropicTools.length > 0 ? { tools: params.anthropicTools } : {}),
        }, { signal: callbacks.signal });

        let contentBuffer = '';
        const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const event of stream) {
            // ── Fix #16: token counting ───────────────────────────────────────
            if (event.type === 'message_start') {
                inputTokens = event.message.usage.input_tokens;
            } else if (event.type === 'message_delta') {
                outputTokens = event.usage.output_tokens;
            } else if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    toolCallBuffers.set(event.index, {
                        id: event.content_block.id,
                        name: event.content_block.name,
                        args: '',
                    });
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    contentBuffer += event.delta.text;
                    callbacks.onChunk?.(event.delta.text);
                } else if (event.delta.type === 'input_json_delta') {
                    const buf = toolCallBuffers.get(event.index);
                    if (buf) buf.args += event.delta.partial_json;
                }
            }
        }

        // Report token usage to observability
        if (inputTokens > 0 || outputTokens > 0) {
            callbacks.onMetrics?.(inputTokens, outputTokens);
        }

        const toolCalls = Array.from(toolCallBuffers.entries())
            .sort(([a], [b]) => a - b)
            .map(([, buf]) => ({
                id: buf.id,
                type: 'function' as const,
                function: { name: buf.name, arguments: buf.args },
            }));

        for (const tc of toolCalls) {
            callbacks.onToolCall?.(tc.function.name, tc.function.arguments, tc.id);
        }

        callbacks.onDone({
            role: 'assistant',
            content: contentBuffer || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
    }
}
