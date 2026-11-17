/**
 * A cap on how many things run at once per key (an agent id, a tenant id). In process: a limit shared across processes is
 * the integrator's implementation of the same interface (SPEC-0023 D4).
 */
export interface ConcurrencyLimiter {
    /** Resolves with a release function once a slot for `key` is free. Rejects if `signal` aborts while waiting. */
    acquire(key: string, signal?: AbortSignal): Promise<() => void>;
}

export interface KeyedLimiterOptions {
    /** Slots per key. A function lets each key have its own. Default: unlimited. */
    max?: number | ((key: string) => number | undefined);
}

export class KeyedConcurrencyLimiter implements ConcurrencyLimiter {
    private readonly active = new Map<string, number>();
    private readonly waiting = new Map<string, Array<() => void>>();

    constructor(private readonly opts: KeyedLimiterOptions = {}) {}

    private limitFor(key: string): number {
        const m = typeof this.opts.max === 'function' ? this.opts.max(key) : this.opts.max;
        return m === undefined ? Infinity : Math.max(1, m);
    }

    async acquire(key: string, signal?: AbortSignal): Promise<() => void> {
        if (signal?.aborted) throw new Error('aborted');
        while ((this.active.get(key) ?? 0) >= this.limitFor(key)) {
            await new Promise<void>((resolve, reject) => {
                const q = this.waiting.get(key) ?? [];
                const wake = (): void => { signal?.removeEventListener('abort', onAbort); resolve(); };
                const onAbort = (): void => {
                    const i = q.indexOf(wake);
                    if (i >= 0) q.splice(i, 1);
                    reject(new Error('aborted'));
                };
                q.push(wake);
                this.waiting.set(key, q);
                signal?.addEventListener('abort', onAbort, { once: true });
            });
        }
        this.active.set(key, (this.active.get(key) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active.set(key, (this.active.get(key) ?? 1) - 1);
            this.waiting.get(key)?.shift()?.();
        };
    }
}
