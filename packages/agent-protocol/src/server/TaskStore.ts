import type { TaskRecord, TaskStatus } from '../types';

export class TaskStore {
    private readonly tasks = new Map<string, TaskRecord>();

    create(taskId: string, capability?: string): TaskRecord {
        const task: TaskRecord = {
            taskId,
            status:    'pending',
            startedAt: new Date().toISOString(),
            ...(capability ? { capability } : {}),
        };
        this.tasks.set(taskId, task);
        return task;
    }

    get(taskId: string): TaskRecord | undefined {
        return this.tasks.get(taskId);
    }

    list(): TaskRecord[] {
        return [...this.tasks.values()];
    }

    setRunning(taskId: string): void {
        const t = this.tasks.get(taskId);
        if (t && t.status === 'pending') t.status = 'running';
    }

    complete(taskId: string, output: unknown, costUsd?: number): void {
        const t = this.tasks.get(taskId);
        if (!t || t.status === 'cancelled') return;
        t.status     = 'done';
        t.output     = output;
        if (costUsd !== undefined) t.costUsd = costUsd;
        t.finishedAt = new Date().toISOString();
        t.durationMs = Date.now() - new Date(t.startedAt).getTime();
    }

    fail(taskId: string, error: string, costUsd?: number): void {
        const t = this.tasks.get(taskId);
        if (!t || t.status === 'cancelled') return;
        t.status     = 'failed';
        t.error      = error;
        if (costUsd !== undefined) t.costUsd = costUsd;
        t.finishedAt = new Date().toISOString();
        t.durationMs = Date.now() - new Date(t.startedAt).getTime();
    }

    cancel(taskId: string): boolean {
        const t = this.tasks.get(taskId);
        if (!t || (t.status !== 'pending' && t.status !== 'running')) return false;
        t.status     = 'cancelled';
        // Without finishedAt a cancelled task never became eligible for evict() and stayed forever.
        t.finishedAt = new Date().toISOString();
        t.durationMs = Date.now() - new Date(t.startedAt).getTime();
        return true;
    }

    /**
     * Drops finished tasks older than `ttlMs` and, as a backstop, tasks still pending/running after
     * `activeTtlMs` (a handler that never settles would otherwise keep its record forever).
     */
    evict(ttlMs = 30 * 60 * 1000, activeTtlMs = 24 * 60 * 60 * 1000): void {
        const now = Date.now();
        for (const [id, t] of this.tasks) {
            const done = t.status === 'done' || t.status === 'failed' || t.status === 'cancelled';
            if (done) {
                if (t.finishedAt && new Date(t.finishedAt).getTime() < now - ttlMs) this.tasks.delete(id);
            } else if (new Date(t.startedAt).getTime() < now - activeTtlMs) {
                this.tasks.delete(id);
            }
        }
    }
}
