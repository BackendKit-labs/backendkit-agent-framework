import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@bk/agent-core';

export interface AnthropicProviderOptions {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContent = Anthropic.ContentBlockParam;

function toAnthropicMessages(messages: LLMMessage[]): { system: string | undefined; messages: AnthropicMessage[] } {
    let system: string | undefined;
    const result: AnthropicMessage[] = [];

    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];

        if (msg.role === 'system') {
            system = msg.content ?? '';
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

    return { system, messages: result };
}

export class AnthropicProvider implements LLMProvider {
    private readonly client: Anthropic;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;

    constructor(opts: AnthropicProviderOptions) {
        this.client = new Anthropic({ apiKey: opts.apiKey });
        this.model = opts.model ?? 'claude-sonnet-4-6';
        this.maxTokens = opts.maxTokens ?? 8192;
        this.temperature = opts.temperature ?? 0.0;
    }

    async chat(
        messages: LLMMessage[],
        tools: ToolDefinition[],
        callbacks: LLMStreamCallbacks,
    ): Promise<void> {
        try {
            const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

            const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters as Anthropic.Tool['input_schema'],
            }));

            const stream = this.client.messages.stream({
                model: this.model,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
                ...(system ? { system } : {}),
                messages: anthropicMessages,
                ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
            });

            let contentBuffer = '';
            const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

            for await (const event of stream) {
                if (event.type === 'content_block_start') {
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
        } catch (err) {
            callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
    }
}
