import Anthropic from '@anthropic-ai/sdk';
import type { LLMMessage, LLMStreamCallbacks, ToolDefinition, ChatOptions, StructuredOutputSupport } from '@backendkit-labs/agent-core';
import { BaseStreamingProvider, StreamIdleError, TRUNCATED_NOTE, type RetryTuning, type ToolCallBuffer } from './BaseStreamingProvider';

/** The slice of the Anthropic SDK the provider uses — inject a double in tests. */
export interface AnthropicClientLike {
    messages: {
        stream(params: unknown, options?: { signal?: AbortSignal }): AsyncIterable<AnthropicStreamEvent>;
    };
}

export type AnthropicStreamEvent = Anthropic.MessageStreamEvent;

/**
 * Prompt caching. The prefix order is tools → system → messages, so keep them stable.
 * - `none`: no `cache_control` (default, requests identical to before).
 * - `system`: breakpoint on the last system block.
 * - `system+tools`: also on the last tool definition.
 * - `auto`: also a moving breakpoint on the last message — suits tool loops.
 */
export type AnthropicCacheMode = 'none' | 'system' | 'system+tools' | 'auto';

export interface AnthropicProviderOptions extends RetryTuning {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    /** Ignored while `thinking` is on (the API requires temperature 1 or absent). */
    temperature?: number;
    /** @deprecated Use `maxAttempts`. Same meaning as before: total attempts, first try included. */
    maxRetries?: number;
    /** Default `none`. */
    cache?: AnthropicCacheMode;
    /** Cache lifetime. Default `5m`; `1h` writes cost about 2x input instead of 1.25x. */
    cacheTtl?: '5m' | '1h';
    /**
     * Extended thinking. `budgetTokens` must be an integer >= 1024 and < `maxTokens`. The thinking
     * blocks (with their signature) are kept in `LLMMessage.raw` and sent back on the next turn,
     * which the API requires while a tool loop continues.
     */
    thinking?: { budgetTokens: number };
    /**
     * How `ChatOptions.responseFormat` is sent. `native` (default): `output_config.format` with the
     * JSON schema. `tool`: a single forced `respond` tool whose input is the answer, for models
     * without native structured output (not compatible with `thinking`, which forbids forced tools).
     */
    structuredOutput?: 'native' | 'tool';
    /** Inject a client instead of building one from `apiKey`. */
    client?: AnthropicClientLike;
}

/** Name of the forced tool used by the `tool` structured-output mode. */
const RESPOND_TOOL = 'respond';

function toolChoiceFor(choice: NonNullable<ChatOptions['toolChoice']>): Anthropic.ToolChoice {
    if (choice === 'auto') return { type: 'auto' };
    if (choice === 'none') return { type: 'none' };
    if (choice === 'required') return { type: 'any' };
    return { type: 'tool', name: choice.name };
}

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContent = Anthropic.ContentBlockParam;
type CacheControl = { type: 'ephemeral'; ttl?: '1h' };

const MIN_THINKING_BUDGET = 1024;

function cacheControl(ttl: '5m' | '1h'): CacheControl {
    return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

// ── Message conversion ────────────────────────────────────────────────────────

interface ConvertOptions { cache: AnthropicCacheMode; ttl: '5m' | '1h' }

/** Concatenates every system message; with caching on they stay separate blocks. */
function toAnthropicMessages(
    messages: LLMMessage[],
    o: ConvertOptions = { cache: 'none', ttl: '5m' },
): { system: string | Anthropic.TextBlockParam[] | undefined; messages: AnthropicMessage[] } {
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
            // Blocks saved by this provider (thinking + signature) go back exactly as received.
            if (Array.isArray(msg.raw)) {
                result.push({ role: 'assistant', content: msg.raw as AnthropicContent[] });
                i++;
                continue;
            }
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

    let system: string | Anthropic.TextBlockParam[] | undefined;
    if (systemParts.length === 0) system = undefined;
    else if (o.cache === 'none') system = systemParts.join('\n\n');
    else {
        system = systemParts.map(text => ({ type: 'text' as const, text }));
        (system[system.length - 1] as { cache_control?: CacheControl }).cache_control = cacheControl(o.ttl);
    }

    if (o.cache === 'auto') markLastMessage(result, cacheControl(o.ttl));
    return { system, messages: result };
}

/** Moving breakpoint: the last block of the last user message. */
function markLastMessage(messages: AnthropicMessage[], cc: CacheControl): void {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return;
    if (typeof last.content === 'string') {
        last.content = [{ type: 'text', text: last.content, cache_control: cc }];
    } else if (last.content.length > 0) {
        (last.content[last.content.length - 1] as { cache_control?: CacheControl }).cache_control = cc;
    }
}

// ── Streamed blocks (kept to rebuild the assistant message) ───────────────────

type StreamBlock =
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string; signature: string }
    | { type: 'redacted_thinking'; data: string }
    | { type: 'tool_use'; id: string; name: string; args: string };

function safeJson(text: string): unknown {
    try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function toRawBlocks(blocks: Map<number, StreamBlock>): unknown[] {
    return [...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => {
        switch (b.type) {
            case 'text': return { type: 'text', text: b.text };
            case 'thinking': return { type: 'thinking', thinking: b.thinking, signature: b.signature };
            case 'redacted_thinking': return { type: 'redacted_thinking', data: b.data };
            case 'tool_use': return { type: 'tool_use', id: b.id, name: b.name, input: safeJson(b.args) };
        }
    });
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class AnthropicProvider extends BaseStreamingProvider {
    private readonly client: AnthropicClientLike;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;
    private readonly cache: AnthropicCacheMode;
    private readonly cacheTtl: '5m' | '1h';
    private readonly thinking?: { budgetTokens: number };
    private readonly structuredMode: 'native' | 'tool';
    readonly capabilities: { structuredOutput: StructuredOutputSupport } = { structuredOutput: 'native' };

    /** Default model; labels traces when the agent profile sets none. */
    get modelId(): string { return this.model; }

    constructor(opts: AnthropicProviderOptions) {
        super({ ...opts, maxAttempts: opts.maxAttempts ?? opts.maxRetries }, { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 16_000 });
        this.client = opts.client
            ?? (new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) as unknown as AnthropicClientLike); // retries live in the base
        this.model = opts.model ?? 'claude-sonnet-4-6';
        this.maxTokens = opts.maxTokens ?? 8192;
        this.temperature = opts.temperature ?? 0.0;
        this.cache = opts.cache ?? 'none';
        this.cacheTtl = opts.cacheTtl ?? '5m';
        this.thinking = opts.thinking;
        this.structuredMode = opts.structuredOutput ?? 'native';

        if (this.thinking && this.structuredMode === 'tool') {
            throw new Error("AnthropicProvider: structuredOutput 'tool' forces a tool and cannot be combined with thinking.");
        }
        if (this.thinking) {
            const b = this.thinking.budgetTokens;
            if (!Number.isInteger(b) || b < MIN_THINKING_BUDGET || b >= this.maxTokens) {
                throw new Error(
                    `AnthropicProvider: thinking.budgetTokens must be an integer >= ${MIN_THINKING_BUDGET} ` +
                    `and < maxTokens (${this.maxTokens}); got ${b}.`,
                );
            }
        }
    }

    protected async stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        const { system, messages: anthropicMessages } = toAnthropicMessages(messages, { cache: this.cache, ttl: this.cacheTtl });
        const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool['input_schema'],
        }));
        if (anthropicTools.length > 0 && (this.cache === 'system+tools' || this.cache === 'auto')) {
            (anthropicTools[anthropicTools.length - 1] as { cache_control?: CacheControl }).cache_control = cacheControl(this.cacheTtl);
        }

        // Structured output: native `output_config`, or one forced tool whose input is the answer.
        const format = options?.responseFormat;
        const viaTool = !!format && this.structuredMode === 'tool';
        if (viaTool) {
            anthropicTools.push({
                name: RESPOND_TOOL,
                description: 'Return the final answer in the required structure.',
                input_schema: format!.schema as Anthropic.Tool['input_schema'],
            });
        }
        const toolChoice = viaTool
            ? ({ type: 'tool', name: RESPOND_TOOL } as Anthropic.ToolChoice)
            : (anthropicTools.length > 0 && options?.toolChoice ? toolChoiceFor(options.toolChoice) : undefined);

        const guard = this.idleGuard(callbacks.signal);
        try {
        const stream = this.client.messages.stream({
            model: callbacks.model ?? this.model,
            max_tokens: this.maxTokens,
            // With thinking on the API wants temperature 1 or absent: leave it out.
            ...(this.thinking
                ? { thinking: { type: 'enabled', budget_tokens: this.thinking.budgetTokens } }
                : { temperature: this.temperature }),
            ...(system ? { system } : {}),
            messages: anthropicMessages,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
            ...(toolChoice ? { tool_choice: toolChoice } : {}),
            ...(format && !viaTool ? { output_config: { format: { type: 'json_schema', schema: format.schema } } } : {}),
        }, { signal: guard.signal });

        let content = '';
        let stopReason: string | null | undefined;
        const buffers = new Map<number, ToolCallBuffer>();
        const blocks = new Map<number, StreamBlock>();
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheRead: number | undefined;
        let cacheWrite: number | undefined;

        for await (const event of guard.watch(stream)) {
            if (event.type === 'message_start') {
                const u = event.message.usage;
                inputTokens = u.input_tokens;
                if (u.cache_read_input_tokens != null) cacheRead = u.cache_read_input_tokens;
                if (u.cache_creation_input_tokens != null) cacheWrite = u.cache_creation_input_tokens;
            } else if (event.type === 'message_delta') {
                outputTokens = event.usage.output_tokens;
                if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            } else if (event.type === 'content_block_start') {
                const b = event.content_block;
                if (b.type === 'tool_use') {
                    buffers.set(event.index, { id: b.id, name: b.name, args: '' });
                    blocks.set(event.index, { type: 'tool_use', id: b.id, name: b.name, args: '' });
                } else if (b.type === 'text') {
                    blocks.set(event.index, { type: 'text', text: '' });
                } else if (b.type === 'thinking') {
                    blocks.set(event.index, { type: 'thinking', thinking: '', signature: '' });
                } else if (b.type === 'redacted_thinking') {
                    blocks.set(event.index, { type: 'redacted_thinking', data: b.data });
                }
            } else if (event.type === 'content_block_delta') {
                const d = event.delta;
                const block = blocks.get(event.index);
                if (d.type === 'text_delta') {
                    content += d.text;
                    if (block?.type === 'text') block.text += d.text;
                    else if (!block) blocks.set(event.index, { type: 'text', text: d.text });
                    callbacks.onChunk?.(d.text);
                } else if (d.type === 'thinking_delta') {
                    if (block?.type === 'thinking') block.thinking += d.thinking;
                    callbacks.onReasoning?.(d.thinking);
                } else if (d.type === 'signature_delta') {
                    if (block?.type === 'thinking') block.signature += d.signature;
                } else if (d.type === 'input_json_delta') {
                    const buf = buffers.get(event.index);
                    if (buf) buf.args += d.partial_json;
                    if (block?.type === 'tool_use') block.args += d.partial_json;
                }
            }
        }

        if (inputTokens > 0 || outputTokens > 0 || cacheRead || cacheWrite) {
            const usage = cacheRead !== undefined || cacheWrite !== undefined
                ? { cacheReadTokens: cacheRead ?? 0, cacheWriteTokens: cacheWrite ?? 0 }
                : undefined;
            callbacks.onMetrics?.(inputTokens, outputTokens, usage);
        }

        // Forced-tool mode: the tool input is the answer; hand it over as plain text.
        if (viaTool) {
            for (const [index, buf] of buffers) {
                if (buf.name !== RESPOND_TOOL) continue;
                content += buf.args;
                callbacks.onChunk?.(buf.args);
                buffers.delete(index);
                blocks.delete(index);
            }
        }

        if (stopReason === 'max_tokens') {
            if (buffers.size > 0) throw new Error('the response hit the output limit (max_tokens) in the middle of a tool call: its arguments are incomplete');
            content += TRUNCATED_NOTE;
            callbacks.onChunk?.(TRUNCATED_NOTE);
        }

        const hasThinking = [...blocks.values()].some(b => b.type === 'thinking' || b.type === 'redacted_thinking');
        this.finish(callbacks, content, buffers, hasThinking ? { raw: toRawBlocks(blocks) } : undefined);
        } catch (err) {
            if (guard.idled()) throw new StreamIdleError(this.streamIdleTimeoutMs);
            throw err;
        } finally {
            guard.stop();
        }
    }
}
