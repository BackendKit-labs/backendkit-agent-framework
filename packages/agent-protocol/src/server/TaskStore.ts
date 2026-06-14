import type { TaskRecord, TaskStatus } from '../types';

export class TaskStore {
    private readonly tasks = new Map<string, TaskRecord>();

    create(taskId: string): TaskRecord {
        const task: TaskRecord = {
            taskId,
            status:    'pending',
            startedAt: new Date().toISOString(),
        };
        this.tasks.set(taskId, task);
        return task;
    }

    get(taskId: string): TaskRecord | undefined {
        return this.tasks.get(taskId);
    }

    setRunning(taskId: string): void {
        const t = this.tasks.get(taskId);
        if (t) t.status = 'running';
    }

    complete(taskId: string, output: unknown): void {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.status     = 'done';
        t.output     = output;
        t.finishedAt = new Date().toISOString();
        t.durationMs = Date.now() - new Date(t.startedAt).getTime();
    }

    fail(taskId: string, error: string): void {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.status     = 'failed';
        t.error      = error;
        t.finishedAt = new Date().toISOString();
        t.durationMs = Date.now() - new Date(t.startedAt).getTime();
    }

    cancel(taskId: string): boolean {
        const t = this.tasks.get(taskId);
        if (!t || (t.status !== 'pending' && t.status !== 'running')) return false;
        t.status = 'cancelled';
        return true;
    }

    // Evict finished tasks older than ttlMs to prevent unbounded memory growth
    evict(ttlMs = 30 * 60 * 1000): void {
        const cutoff = Date.now() - ttlMs;
        for (const [id, t] of this.tasks) {
            const done = t.status === 'done' || t.status === 'failed' || t.status === 'cancelled';
            if (done && t.finishedAt && new Date(t.finishedAt).getTime() < cutoff) {
                this.tasks.delete(id);
            }
        }
    }
}
