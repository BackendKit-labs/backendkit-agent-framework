import { claimRun, withRunClaim } from '../gate-claims.js';

const tick = () => new Promise<void>(r => setImmediate(r));

describe('claimRun', () => {
    it('hands the run to one caller at a time and frees it on release', () => {
        const release = claimRun('run-1');
        expect(release).toBeInstanceOf(Function);
        expect(claimRun('run-1')).toBeNull();
        expect(claimRun('run-2')).toBeInstanceOf(Function); // other runs are independent
        release!();
        const again = claimRun('run-1');
        expect(again).toBeInstanceOf(Function);
        again!();
    });

    it('a stale release does not free a claim someone else took in between', () => {
        const first = claimRun('run-3')!;
        first();
        const second = claimRun('run-3')!;
        first(); // calling an old release again
        expect(claimRun('run-3')).toBeNull(); // the second claim is still held
        second();
        expect(claimRun('run-3')).toBeInstanceOf(Function);
    });
});

describe('withRunClaim', () => {
    it('two overlapping approvals of the same run: one runs, the other is told it is busy', async () => {
        let gate!: () => void;
        const running = new Promise<void>(r => { gate = r; });
        let executions = 0;

        const first = withRunClaim('run-a', () => 'busy', async () => { executions++; await running; return 'resumed'; });
        await tick();
        const second = withRunClaim('run-a', () => 'busy', async () => { executions++; return 'resumed'; });

        expect(await second).toBe('busy');
        gate();
        expect(await first).toBe('resumed');
        expect(executions).toBe(1);
    });

    it('is released after the work finishes, so the run can be decided again', async () => {
        expect(await withRunClaim('run-b', () => 'busy', async () => 'one')).toBe('one');
        expect(await withRunClaim('run-b', () => 'busy', async () => 'two')).toBe('two');
    });

    it('is released when the work throws', async () => {
        await expect(withRunClaim('run-c', () => 'busy', async () => { throw new Error('store down'); })).rejects.toThrow('store down');
        expect(await withRunClaim('run-c', () => 'busy', async () => 'ok')).toBe('ok');
    });

    it('many simultaneous approvals execute exactly once', async () => {
        let executions = 0;
        const results = await Promise.all(Array.from({ length: 20 }, () =>
            withRunClaim('run-d', () => 'busy', async () => { executions++; await tick(); return 'resumed'; })));
        expect(executions).toBe(1);
        expect(results.filter(r => r === 'resumed')).toHaveLength(1);
        expect(results.filter(r => r === 'busy')).toHaveLength(19);
    });
});
