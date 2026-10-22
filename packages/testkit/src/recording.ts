import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatOptions, LLMMessage, LLMProvider, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';

type LLMUsageDetails = NonNullable<Parameters<NonNullable<LLMStreamCallbacks['onMetrics']>>[2]>;

/** One thing the provider did during a call, `t` ms after the call started. */
export type RecordedEvent =
    | { t: number; type: 'chunk'; delta: string }
    | { t: number; type: 'reasoning'; delta: string }
    | { t: number; type: 'tool_call'; name: string; args: string; id: string }
    | { t: number; type: 'metrics'; inputTokens: number; outputTokens: number; usage?: LLMUsageDetails }
    | { t: number; type: 'done'; message: LLMMessage }
    | { t: number; type: 'error'; error: RecordedError };

/** An error reduced to what the code that handles provider failures looks at. */
export interface RecordedError {
    name: string;
    message: string;
    status?: number;
    code?: string;
}

/** One `chat()` call: what was asked and everything that came back. */
export interface RecordedCall {
    /** Format version of the file. */
    v: 1;
    /** 0-based position in the recording. */
    index: number;
    startedAt: number;
    durationMs: number;
    model?: string;
    request: { messages: LLMMessage[]; tools: string[]; options?: ChatOptions };
    events: RecordedEvent[];
}

export type RecordingSink = string | ((call: RecordedCall) => void);

export interface RecordingOptions {
    /** Edit or censor a call before it is written (recordings contain the whole conversation). */
    redact?: (call: RecordedCall) => RecordedCall;
}

export function serializeError(err: unknown): RecordedError {
    const e = (err ?? {}) as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown };
    return {
        name: typeof e.name === 'string' ? e.name : 'Error',
        message: typeof e.message === 'string' ? e.message : String(err),
        ...(typeof (e.status ?? e.statusCode) === 'number' ? { status: (e.status ?? e.statusCode) as number } : {}),
        ...(typeof e.code === 'string' ? { code: e.code } : {}),
    };
}

/** Rebuilds an `Error` carrying the same `name`, `status` and `code`, so retry and overflow checks behave as live. */
export function deserializeError(rec: RecordedError): Error {
    const err = new Error(rec.message);
    err.name = rec.name;
    if (rec.status !== undefined) (err as { status?: number }).status = rec.status;
    if (rec.code !== undefined) (err as { code?: string }).code = rec.code;
    return err;
}

/**
 * Wraps a real provider and writes every call (request, streamed events, metrics, errors, timings) as
 * one JSON line, to a file or to a function. The wrapped provider behaves exactly as before.
 * The file contains the full conversation: treat it as sensitive and use `redact` when needed.
 */
export class RecordingProvider implements LLMProvider {
    private index = 0;

    constructor(
        private readonly inner: LLMProvider,
        private readonly sink: RecordingSink,
        private readonly options: RecordingOptions = {},
    ) {
        if (typeof sink === 'string') mkdirSync(dirname(sink), { recursive: true });
    }

    get capabilities() { return this.inner.capabilities; }
    get modelId() { return this.inner.modelId; }

    async chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        const startedAt = Date.now();
        const events: RecordedEvent[] = [];
        const t = () => Date.now() - startedAt;
        const recorded: LLMStreamCallbacks = {
            ...callbacks,
            onChunk: (delta) => { events.push({ t: t(), type: 'chunk', delta }); callbacks.onChunk?.(delta); },
            onReasoning: (delta) => { events.push({ t: t(), type: 'reasoning', delta }); callbacks.onReasoning?.(delta); },
            onToolCall: (name, args, id) => { events.push({ t: t(), type: 'tool_call', name, args, id }); callbacks.onToolCall?.(name, args, id); },
            onMetrics: (inputTokens, outputTokens, usage) => {
                events.push({ t: t(), type: 'metrics', inputTokens, outputTokens, ...(usage ? { usage } : {}) });
                callbacks.onMetrics?.(inputTokens, outputTokens, usage);
            },
            onDone: (message) => { events.push({ t: t(), type: 'done', message }); callbacks.onDone(message); },
            onError: (err) => { events.push({ t: t(), type: 'error', error: serializeError(err) }); callbacks.onError(err); },
        };
        const index = this.index++;
        try {
            await this.inner.chat(messages, tools, recorded, options);
        } catch (err) {
            // A provider that throws instead of calling onError: keep the evidence, let the caller see it.
            events.push({ t: t(), type: 'error', error: serializeError(err) });
            throw err;
        } finally {
            let call: RecordedCall = {
                v: 1, index, startedAt, durationMs: t(),
                ...(callbacks.model ? { model: callbacks.model } : {}),
                request: { messages, tools: tools.map(x => x.name), ...(options ? { options } : {}) },
                events,
            };
            if (this.options.redact) call = this.options.redact(call);
            if (typeof this.sink === 'string') appendFileSync(this.sink, JSON.stringify(call) + '\n');
            else this.sink(call);
        }
    }
}
