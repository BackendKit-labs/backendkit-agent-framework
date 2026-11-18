import type {
    LLMMessage, LLMStreamCallbacks, ToolDefinition, ChatOptions, StructuredOutputSupport,
} from '@backendkit-labs/agent-core';
import { BaseStreamingProvider } from './BaseStreamingProvider';
import type { RetryTuning, ToolCallBuffer } from './BaseStreamingProvider';

/**
 * A language model of the Vercel AI SDK (`google('gemini-2.5-pro')`, `openai('gpt-5')`...), declared by shape so this package
 * depends on no version of the SDK. Interface versions 2, 3 and 4 are understood (SPEC-0029 §8).
 */
export interface AiSdkModelLike {
    readonly specificationVersion: string;
    readonly provider: string;
    readonly modelId: string;
    doStream(options: never): PromiseLike<{ stream: ReadableStream<unknown> }>;
}

export interface AiSdkProviderOptions extends RetryTuning {
    /** What the model guarantees for `responseFormat`. Default `none`: whether it holds depends on the provider behind the model. */
    structuredOutput?: StructuredOutputSupport;
    temperature?: number;
    maxOutputTokens?: number;
    /** Passed to the model as `providerOptions` (`{ google: { thinkingConfig: ... } }`). */
    providerOptions?: Record<string, Record<string, unknown>>;
}

type Json = Record<string, unknown>;

/** `LLMProvider` over any model of the AI SDK. The model only talks to the provider; the engine runs the tools (they carry no `execute`). */
export class AiSdkProvider extends BaseStreamingProvider {
    readonly modelId: string;
    readonly capabilities: { structuredOutput: StructuredOutputSupport };

    constructor(private readonly model: AiSdkModelLike, private readonly opts: AiSdkProviderOptions = {}) {
        super(opts, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000 });
        if (typeof model !== 'object' || model === null || typeof model.doStream !== 'function') {
            throw new Error('fromAiSdk needs a model object (for example google("gemini-2.5-pro")), not a model id string');
        }
        if (!['v2', 'v3', 'v4'].includes(model.specificationVersion)) {
            throw new Error(`fromAiSdk does not know the model interface "${String(model.specificationVersion)}" (supported: v2, v3, v4)`);
        }
        this.modelId = model.modelId;
        this.capabilities = { structuredOutput: opts.structuredOutput ?? 'none' };
    }

    protected async stream(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        const callOptions: Json = { prompt: toPrompt(messages), abortSignal: callbacks.signal };
        if (tools.length > 0) {
            callOptions.tools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, inputSchema: t.parameters }));
            if (options?.toolChoice !== undefined) callOptions.toolChoice = toToolChoice(options.toolChoice);
        }
        if (options?.responseFormat) {
            callOptions.responseFormat = { type: 'json', schema: options.responseFormat.schema, name: options.responseFormat.name };
        }
        if (this.opts.temperature !== undefined) callOptions.temperature = this.opts.temperature;
        if (this.opts.maxOutputTokens !== undefined) callOptions.maxOutputTokens = this.opts.maxOutputTokens;
        if (this.opts.providerOptions) callOptions.providerOptions = this.opts.providerOptions;

        const { stream } = await this.model.doStream(callOptions as never);
        const reader = stream.getReader();
        let text = '';
        const calls = new Map<number, ToolCallBuffer>();
        let usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | undefined;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                const part = value as Json;
                switch (part.type) {
                    case 'text-delta': {
                        const delta = String(part.delta ?? part.text ?? '');
                        if (delta) { text += delta; callbacks.onChunk?.(delta); }
                        break;
                    }
                    case 'reasoning-delta': {
                        const delta = String(part.delta ?? part.text ?? '');
                        if (delta) callbacks.onReasoning?.(delta);
                        break;
                    }
                    case 'tool-call':
                        // The call arrives whole; the tool-input-* parts only report its progress.
                        calls.set(calls.size, {
                            id: String(part.toolCallId),
                            name: String(part.toolName),
                            args: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
                        });
                        break;
                    case 'finish':
                        usage = readUsage(part.usage);
                        break;
                    case 'error':
                        throw part.error instanceof Error ? part.error : new Error(String(typeof part.error === 'string' ? part.error : JSON.stringify(part.error)));
                    default:
                        break; // stream-start, response-metadata, ping, raw, source, file, tool-input-*, text-start/end...
                }
            }
        } finally {
            reader.releaseLock();
        }
        if (usage) {
            const details = usage.cacheRead || usage.cacheWrite ? { cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite } : undefined;
            callbacks.onMetrics?.(usage.input, usage.output, details);
        }
        this.finish(callbacks, text, calls);
    }
}

/** `LLMProvider` for a model of the Vercel AI SDK: `fromAiSdk(google('gemini-2.5-pro'))`. */
export function fromAiSdk(model: AiSdkModelLike, opts: AiSdkProviderOptions = {}): AiSdkProvider {
    return new AiSdkProvider(model, opts);
}

// ── Translation ─────────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(args: string): unknown {
    try { return JSON.parse(args || '{}'); } catch { return {}; }
}

export function toPrompt(messages: LLMMessage[]): Json[] {
    const toolNames = new Map<string, string>();
    const prompt: Json[] = [];
    for (const m of messages) {
        if (m.role === 'system') {
            prompt.push({ role: 'system', content: m.content ?? '' });
        } else if (m.role === 'user') {
            prompt.push({ role: 'user', content: [{ type: 'text', text: m.content ?? '' }] });
        } else if (m.role === 'assistant') {
            const content: Json[] = [];
            if (m.content) content.push({ type: 'text', text: m.content });
            for (const tc of m.tool_calls ?? []) {
                toolNames.set(tc.id, tc.function.name);
                content.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.function.name, input: parseArgs(tc.function.arguments) });
            }
            prompt.push({ role: 'assistant', content });
        } else {
            const id = m.tool_call_id ?? '';
            prompt.push({
                role: 'tool',
                content: [{ type: 'tool-result', toolCallId: id, toolName: toolNames.get(id) ?? '', output: { type: 'text', value: m.content ?? '' } }],
            });
        }
    }
    return prompt;
}

function toToolChoice(choice: NonNullable<ChatOptions['toolChoice']>): Json {
    return typeof choice === 'string' ? { type: choice } : { type: 'tool', toolName: choice.name };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Version 3 and 4 report `{ inputTokens: { total, cacheRead, cacheWrite }, outputTokens: { total } }`; version 2 reports plain numbers. */
function readUsage(raw: unknown): { input: number; output: number; cacheRead?: number; cacheWrite?: number } | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const u = raw as Json;
    const inp = u.inputTokens;
    const out = u.outputTokens;
    if (inp !== null && typeof inp === 'object') {
        const i = inp as Json;
        return { input: num(i.total) ?? 0, output: num((out as Json | undefined)?.total) ?? 0, cacheRead: num(i.cacheRead), cacheWrite: num(i.cacheWrite) };
    }
    return { input: num(inp) ?? 0, output: num(out) ?? 0, cacheRead: num(u.cachedInputTokens) };
}
