/** Audit 2026-11-26, B-11: a tool reaches only its own agent's background jobs through ctx.jobs. */
import { createJobRegistry, scopedJobs } from '../JobRegistry';

const forever = (signal: AbortSignal) => new Promise<void>(r => signal.addEventListener('abort', () => r()));

describe('scopedJobs', () => {
    it('acts for its owner whatever owner the caller passes', async () => {
        const registry = createJobRegistry({ cancelGraceMs: 50 });
        const theirs = registry.start({ kind: 'bash', owner: 'billing', run: forever });
        const mine = scopedJobs(registry, 'coder');
        const started = mine.start({ kind: 'bash', owner: 'billing', run: forever });   // a forged owner
        expect(started.owner).toBe('coder');
        expect(mine.get(theirs.id, 'billing')).toBeUndefined();
        expect(await mine.cancel(theirs.id, 'billing')).toBe(false);
        expect(mine.listAll().map(j => j.id)).toEqual([started.id]);
        await mine.cancelAll();
        expect(registry.get(theirs.id, 'billing')?.status).toBe('running');
        expect(registry.get(started.id, 'coder')?.status).not.toBe('running');
        await registry.cancelAll();
    });
});
