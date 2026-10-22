import { existsSync, readFileSync } from 'node:fs';
import type { ChatOptions, LLMMessage, LLMProvider, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';
import { deserializeError, type RecordedCall, type RecordedError, type RecordedEvent } from './recording';

/**
 * Faults to inject, keyed by the 1-based number of the `chat()` invocation. An injected invocation does
 * NOT use up a recorded call: the next invocation plays the next recorded one, which is what a retry
 * (or the engine's overflow recovery) would see live.
 */
export interface ReplayOverrides {
    inject?: Record<string, ReplayFault>;
}

export type ReplayFault =
    /** Fail before the first chunk with this error (e.g. `{ status: 429 }` or the context-overflow 400). */
    | { error: Partial<RecordedError> & { message: string } }
    /** The call is cancelled: it ends with an `AbortError`. */
    | { cancel: true }
    /** The call never answers until its `signal` is aborted (requires a signal). */
    | { hang: true };

export interface ReplayOptions {
    /** Overrides as an object, or the path of a JSON file. Default: `<recording>.override.json` next to the file, when it exists. */
    overrides?: ReplayOverrides | string;
    /** Fail a call whose request differs from the recorded one. Default false. */
    verifyRequests?: boolean;
    /** `recorded` waits the original time between events. Default `instant`. */
    timing?: 'instant' | 'recorded';
}

function abortError(message: string): Error {
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
}

/** Reads a JSONL recording written by `RecordingProvider`. */
export function readRecording(path: string): RecordedCall[] {
    return readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line, i) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as RecordedCall]; }
        catch { throw new Error(`readRecording: ${path} line ${i + 1} is not valid JSON`); }
    });
}

function firstDifference(a: LLMMessage[], b: LLMMessage[]): string {
    if (a.length !== b.length) return `${a.length} messages sent, ${b.length} recorded`;
    for (let i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `message ${i} (${a[i].role}) differs`;
    }
    return 'requests differ';
}

/**
 * A provider that replays a recording: the same chunks, tool calls, metrics and errors, in order, with
 * no network and no API key. Overrides inject failures the recording does not contain.
 * `replay.requests` holds what the code under test sent on each invocation.
 */
export class ReplayProvider implements LLMProvider {
    readonly requests: Array<{ messages: LLMMessage[]; tools: string[]; options?: ChatOptions }> = [];
    private readonly calls: RecordedCall[];
    private readonly overrides: ReplayOverrides;
    private cursor = 0;
    private invocation = 0;

    constructor(source: string | RecordedCall[], private readonly options: ReplayOptions = {}) {
        this.calls = typeof source === 'string' ? readRecording(source) : source;
        let overrides = options.overrides;
        if (overrides === undefined && typeof source === 'string') {
            const sidecar = source.replace(/\.jsonl?$/, '') + '.override.json';
            if (existsSync(sidecar)) overrides = sidecar;
        }
        this.overrides = typeof overrides === 'string' ? JSON.parse(readFileSync(overrides, 'utf8')) : overrides ?? {};
    }

    /** Recorded calls not played yet. */
    remaining(): number { return this.calls.length - this.cursor; }

    async chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void> {
        const n = ++this.invocation;
        this.requests.push({ messages, tools: tools.map(t => t.name), ...(options ? { options } : {}) });

        const fault = this.overrides.inject?.[String(n)];
        if (fault) return this.playFault(fault, callbacks);

        const call = this.calls[this.cursor];
        if (!call) {
            callbacks.onError(new Error(`ReplayProvider: invocation ${n} has no recorded call (the recording has ${this.calls.length})`));
            return;
        }
        if (this.options.verifyRequests && JSON.stringify(call.request.messages) !== JSON.stringify(messages)) {
            callbacks.onError(new Error(`ReplayProvider: invocation ${n} does not match recorded call ${call.index}: ${firstDifference(messages, call.request.messages)}`));
            return;
        }
        this.cursor++;
        await this.play(call.events, callbacks);
    }

    private async playFault(fault: ReplayFault, callbacks: LLMStreamCallbacks): Promise<void> {
        if ('error' in fault) {
            callbacks.onError(deserializeError({ name: 'Error', ...fault.error }));
        } else if ('cancel' in fault) {
            callbacks.onError(abortError('ReplayProvider: call cancelled by override'));
        } else {
            const signal = callbacks.signal;
            if (!signal) throw new Error('ReplayProvider: a "hang" override needs the call to carry a signal');
            await new Promise<void>(resolve => {
                if (signal.aborted) resolve();
                else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            callbacks.onError(abortError('ReplayProvider: hung call aborted'));
        }
    }

    private async play(events: RecordedEvent[], callbacks: LLMStreamCallbacks): Promise<void> {
        let elapsed = 0;
        for (const e of events) {
            if (callbacks.signal?.aborted) { callbacks.onError(abortError('ReplayProvider: aborted during replay')); return; }
            if (this.options.timing === 'recorded' && e.t > elapsed) {
                await new Promise(r => setTimeout(r, e.t - elapsed));
                elapsed = e.t;
            }
            switch (e.type) {
                case 'chunk': callbacks.onChunk?.(e.delta); break;
                case 'reasoning': callbacks.onReasoning?.(e.delta); break;
                case 'tool_call': callbacks.onToolCall?.(e.name, e.args, e.id); break;
                case 'metrics': callbacks.onMetrics?.(e.inputTokens, e.outputTokens, e.usage); break;
                case 'done': callbacks.onDone(e.message); break;
                case 'error': callbacks.onError(deserializeError(e.error)); break;
            }
        }
    }
}
