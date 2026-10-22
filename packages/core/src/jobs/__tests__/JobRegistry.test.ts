import { createJobRegistry } from '../JobRegistry';

const tick = () => new Promise<void>(r => setImmediate(r));

function deferred() {
    let resolve!: (v?: string) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<string | void>((res, rej) => { resolve = res as never; reject = rej; });
    return { promise, resolve, reject };
}

describe('JobRegistry', () => {
    it('runs start → output → done and keeps the summary', async () => {
        const reg = createJobRegistry();
        const gate = deferred();
        const info = reg.start({ kind: 'bash', owner: 'a', run: async (_s, append) => { append('hello '); await gate.promise; append('world'); return 'exit 0'; } });
        expect(info).toMatchObject({ id: 'bash-1', status: 'running' });
        await tick();
        expect(await reg.output('bash-1', 'a')).toEqual({ text: 'hello ', nextOffset: 6, done: false });
        gate.resolve();
        await tick(); await tick();
        expect(await reg.output('bash-1', 'a', { sinceOffset: 6 })).toEqual({ text: 'world', nextOffset: 11, done: true });
        expect(reg.get('bash-1', 'a')).toMatchObject({ status: 'done', summary: 'exit 0' });
    });

    it('ids are per kind', () => {
        const reg = createJobRegistry();
        const run = () => new Promise<void>(() => undefined);
        expect(reg.start({ kind: 'bash', owner: 'a', run }).id).toBe('bash-1');
        expect(reg.start({ kind: 'bash', owner: 'a', run }).id).toBe('bash-2');
        expect(reg.start({ kind: 'test', owner: 'a', run }).id).toBe('test-1');
    });

    it('a failing job is marked failed with the error as summary', async () => {
        const reg = createJobRegistry();
        reg.start({ kind: 'bash', owner: 'a', run: async () => { throw new Error('boom'); } });
        await tick();
        expect(reg.get('bash-1', 'a')).toMatchObject({ status: 'failed', summary: 'boom' });
    });

    it('another owner cannot read, list or cancel it', async () => {
        const reg = createJobRegistry();
        reg.start({ kind: 'bash', owner: 'a', run: () => new Promise<void>(() => undefined) });
        expect(reg.get('bash-1', 'b')).toBeUndefined();
        await expect(reg.output('bash-1', 'b')).rejects.toThrow('not found');
        expect(await reg.cancel('bash-1', 'b')).toBe(false);
        expect(reg.list('b')).toEqual([]);
        expect(reg.list('a')).toHaveLength(1);
    });

    it('limits live jobs per owner with JOB_LIMIT_REACHED, and frees the slot when one ends', async () => {
        const reg = createJobRegistry({ maxPerOwner: 2 });
        const gate = deferred();
        reg.start({ kind: 'bash', owner: 'a', run: () => gate.promise });
        reg.start({ kind: 'bash', owner: 'a', run: () => new Promise<void>(() => undefined) });
        expect(() => reg.start({ kind: 'bash', owner: 'a', run: async () => undefined })).toThrow(/JOB_LIMIT_REACHED/);
        expect(() => reg.start({ kind: 'bash', owner: 'b', run: async () => undefined })).not.toThrow();
        gate.resolve();
        await tick(); await tick();
        expect(() => reg.start({ kind: 'bash', owner: 'a', run: async () => undefined })).not.toThrow();
    });

    it('keeps a ring of the latest output with absolute offsets', async () => {
        const reg = createJobRegistry({ retainOutputBytes: 10 });
        reg.start({ kind: 'bash', owner: 'a', run: async (_s, append) => { append('0123456789'); append('ABCDE'); } });
        await tick();
        const out = await reg.output('bash-1', 'a');
        expect(out.text).toBe('56789ABCDE');
        expect(out.nextOffset).toBe(15);
        // Reading from an offset that was already dropped starts at the oldest retained character.
        expect((await reg.output('bash-1', 'a', { sinceOffset: 2 })).text).toBe('56789ABCDE');
        expect((await reg.output('bash-1', 'a', { sinceOffset: 12 })).text).toBe('CDE');
    });

    it('output waits for new data up to waitMs and returns early when it arrives', async () => {
        const reg = createJobRegistry();
        let push!: (s: string) => void;
        reg.start({ kind: 'bash', owner: 'a', run: (_s, append) => { push = append; return new Promise<void>(() => undefined); } });
        await tick();
        const started = Date.now();
        const pending = reg.output('bash-1', 'a', { waitMs: 5000 });
        setTimeout(() => push('late'), 20);
        expect((await pending).text).toBe('late');
        expect(Date.now() - started).toBeLessThan(2000);
        const t0 = Date.now();
        expect((await reg.output('bash-1', 'a', { sinceOffset: 4, waitMs: 60 })).text).toBe('');
        expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
    });

    it('cancel aborts the signal and marks the job cancelled', async () => {
        const reg = createJobRegistry();
        let aborted = false;
        reg.start({ kind: 'bash', owner: 'a', run: (signal) => new Promise<void>(res => signal.addEventListener('abort', () => { aborted = true; res(); })) });
        expect(await reg.cancel('bash-1', 'a')).toBe(true);
        expect(aborted).toBe(true);
        expect(reg.get('bash-1', 'a')?.status).toBe('cancelled');
        expect(await reg.cancel('bash-1', 'a')).toBe(false);
    });

    it('a job that dies with an error because it was cancelled is cancelled, without that error as summary', async () => {
        const reg = createJobRegistry();
        reg.start({ kind: 'bash', owner: 'a', run: (signal) => new Promise<void>((_res, rej) => signal.addEventListener('abort', () => rej(new Error('exit 1')))) });
        await reg.cancel('bash-1', 'a');
        expect(reg.get('bash-1', 'a')).toMatchObject({ status: 'cancelled' });
        expect(reg.get('bash-1', 'a')?.summary).toBeUndefined();
    });

    it('cancel gives up waiting for a job that ignores its signal', async () => {
        const reg = createJobRegistry({ cancelGraceMs: 30 });
        reg.start({ kind: 'bash', owner: 'a', run: () => new Promise<void>(() => undefined) });
        expect(await reg.cancel('bash-1', 'a')).toBe(true);
        expect(reg.get('bash-1', 'a')?.status).toBe('cancelled');
    });

    it('drainFinished reports each finished job once', async () => {
        const reg = createJobRegistry();
        reg.start({ kind: 'bash', owner: 'a', run: async () => undefined });
        reg.start({ kind: 'bash', owner: 'a', run: () => new Promise<void>(() => undefined) });
        await tick();
        expect(reg.drainFinished('a').map(j => j.id)).toEqual(['bash-1']);
        expect(reg.drainFinished('a')).toEqual([]);
        expect(reg.drainFinished('b')).toEqual([]);
    });

    it('purges finished jobs after retainFinishedMs', async () => {
        jest.useFakeTimers({ now: 1_000_000, doNotFake: ['setImmediate', 'nextTick'] });
        try {
            const reg = createJobRegistry({ retainFinishedMs: 60_000 });
            reg.start({ kind: 'bash', owner: 'a', run: async () => undefined });
            await tick();
            jest.setSystemTime(1_000_000 + 59_000);
            expect(reg.get('bash-1', 'a')).toBeDefined();
            jest.setSystemTime(1_000_000 + 61_000);
            expect(reg.get('bash-1', 'a')).toBeUndefined();
        } finally { jest.useRealTimers(); }
    });

    it('cancelAll stops every running job', async () => {
        const reg = createJobRegistry({ cancelGraceMs: 20 });
        reg.start({ kind: 'bash', owner: 'a', run: () => new Promise<void>(() => undefined) });
        reg.start({ kind: 'bash', owner: 'b', run: () => new Promise<void>(() => undefined) });
        await reg.cancelAll();
        expect(reg.list('a')[0].status).toBe('cancelled');
        expect(reg.list('b')[0].status).toBe('cancelled');
    });
});
