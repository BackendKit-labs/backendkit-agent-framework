import { TaskStore } from '../server/TaskStore';

describe('TaskStore', () => {
    it('create() starts a task as pending', () => {
        const store = new TaskStore();
        const t = store.create('t1');
        expect(t).toMatchObject({ taskId: 't1', status: 'pending' });
        expect(store.get('t1')).toBe(t);
    });

    it('get() returns undefined for unknown ids', () => {
        expect(new TaskStore().get('nope')).toBeUndefined();
    });

    it('follows pending -> running -> done and records output and duration', () => {
        const store = new TaskStore();
        store.create('t1');
        store.setRunning('t1');
        expect(store.get('t1')!.status).toBe('running');
        store.complete('t1', { x: 1 });
        const t = store.get('t1')!;
        expect(t).toMatchObject({ status: 'done', output: { x: 1 } });
        expect(t.finishedAt).toBeDefined();
        expect(t.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fail() records the error', () => {
        const store = new TaskStore();
        store.create('t1');
        store.fail('t1', 'boom');
        expect(store.get('t1')).toMatchObject({ status: 'failed', error: 'boom' });
    });

    it('cancel() works on pending and running, not on finished tasks', () => {
        const store = new TaskStore();
        store.create('p');
        store.create('r'); store.setRunning('r');
        store.create('d'); store.complete('d', 1);
        expect(store.cancel('p')).toBe(true);
        expect(store.cancel('r')).toBe(true);
        expect(store.cancel('d')).toBe(false);
        expect(store.cancel('missing')).toBe(false);
        expect(store.get('d')!.status).toBe('done');
    });

    it('a cancelled task stays cancelled when the handler later completes or fails', () => {
        const store = new TaskStore();
        store.create('a'); store.setRunning('a'); store.cancel('a');
        store.complete('a', 'late');
        expect(store.get('a')!.status).toBe('cancelled');
        expect(store.get('a')!.output).toBeUndefined();

        store.create('b'); store.setRunning('b'); store.cancel('b');
        store.fail('b', 'late error');
        expect(store.get('b')!.status).toBe('cancelled');
        expect(store.get('b')!.error).toBeUndefined();
    });

    it('evict() drops only finished tasks older than the ttl', () => {
        const store = new TaskStore();
        store.create('old'); store.complete('old', 1);
        store.create('running'); store.setRunning('running');
        store.create('fresh'); store.complete('fresh', 1);
        store.get('old')!.finishedAt = new Date(Date.now() - 60_000).toISOString();

        store.evict(30_000);

        expect(store.get('old')).toBeUndefined();
        expect(store.get('running')).toBeDefined();
        expect(store.get('fresh')).toBeDefined();
    });

    it('cancel() stamps finishedAt and durationMs, so a cancelled task can be evicted', () => {
        const store = new TaskStore();
        store.create('c'); store.setRunning('c');
        expect(store.cancel('c')).toBe(true);
        const t = store.get('c')!;
        expect(t.finishedAt).toBeDefined();
        expect(t.durationMs).toBeGreaterThanOrEqual(0);

        t.finishedAt = new Date(Date.now() - 60_000).toISOString();
        store.evict(30_000);
        expect(store.get('c')).toBeUndefined();
    });

    it('evict() drops a pending/running task that never settled after activeTtlMs, and keeps younger ones', () => {
        const store = new TaskStore();
        store.create('stuck'); store.setRunning('stuck');
        store.create('queued');
        store.create('young'); store.setRunning('young');
        store.get('stuck')!.startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
        store.get('queued')!.startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();

        store.evict(30_000, 3_600_000);

        expect(store.get('stuck')).toBeUndefined();
        expect(store.get('queued')).toBeUndefined();
        expect(store.get('young')).toBeDefined();
    });

    it('a running task is kept by default (active ttl is 24 h)', () => {
        const store = new TaskStore();
        store.create('long'); store.setRunning('long');
        store.get('long')!.startedAt = new Date(Date.now() - 3_600_000).toISOString();
        store.evict();
        expect(store.get('long')).toBeDefined();
    });
});
