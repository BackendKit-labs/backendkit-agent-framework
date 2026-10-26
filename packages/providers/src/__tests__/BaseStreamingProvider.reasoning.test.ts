import type { LLMStreamCallbacks } from '@backendkit-labs/agent-core';
import { BaseStreamingProvider } from '../BaseStreamingProvider';
import { httpError } from './helpers';

/** A provider whose every attempt runs `script` against the callbacks it is given. */
class Scripted extends BaseStreamingProvider {
    attempts = 0;
    constructor(private readonly script: (attempt: number, cb: LLMStreamCallbacks) => void) {
        super({ maxAttempts: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 2 }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
    }
    get modelId() { return 'scripted'; }
    protected async stream(_m: never, _t: never, cb: LLMStreamCallbacks): Promise<void> {
        this.script(++this.attempts, cb);
    }
}

const callbacks = (): LLMStreamCallbacks & { reasoning: string[]; errors: Error[] } => {
    const reasoning: string[] = [];
    const errors: Error[] = [];
    return { reasoning, errors, onChunk: () => undefined, onDone: () => undefined, onError: (e: Error) => { errors.push(e); }, onReasoning: (d: string) => { reasoning.push(d); } } as never;
};

describe('BaseStreamingProvider — never retry after the caller saw output', () => {
    it('does not retry a transient failure that happens after reasoning tokens were emitted', async () => {
        const p = new Scripted((_attempt, cb) => { cb.onReasoning?.('thinking…'); throw httpError(503); });
        const cb = callbacks();
        await p.chat([], [], cb);
        expect(p.attempts).toBe(1);
        expect(cb.reasoning).toEqual(['thinking…']);
        expect(cb.errors).toHaveLength(1);
    });

    it('does not retry after content either (unchanged)', async () => {
        const p = new Scripted((_a, cb) => { cb.onChunk?.('hi'); throw httpError(503); });
        const cb = callbacks();
        await p.chat([], [], cb);
        expect(p.attempts).toBe(1);
    });

    it('still retries when nothing was emitted yet', async () => {
        const p = new Scripted((attempt, cb) => {
            if (attempt < 3) throw httpError(503);
            cb.onChunk?.('ok');
        });
        const cb = callbacks();
        await p.chat([], [], cb);
        expect(p.attempts).toBe(3);
        expect(cb.errors).toHaveLength(0);
    });

    it('works for a caller with no onReasoning listener', async () => {
        const p = new Scripted((_a, cb) => { cb.onReasoning?.('x'); throw httpError(503); });
        const cb = callbacks();
        delete (cb as { onReasoning?: unknown }).onReasoning;
        await p.chat([], [], cb);
        expect(p.attempts).toBe(1);
    });
});
