import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import type { FlowStep, StepExecutor, StepInput, StepOutput } from '@backendkit-labs/agent-core';

export { RedisRunJournal } from './redis-journal';
export type { RedisRunJournalOptions } from './redis-journal';

/**
 * BullMQ adapter for `StepExecutor` (SPEC-0023 D5). The flow engine stays in one process; each step travels through a
 * queue `<prefix>.<agent>` to a worker, possibly on another machine. Semantics are at-least-once: the job id is the
 * step's idempotency key (`runId:stepId:attempt`), so a step enqueued twice is one job, and a step with an external
 * effect must use `input.idempotencyKey` in the worker too.
 */

export const DEFAULT_QUEUE_PREFIX = 'flow';
/** How long the executor waits for a worker to finish one step. */
export const DEFAULT_STEP_TIMEOUT_MS = 900_000;

export interface StepJobData {
    step: FlowStep;
    prompt: string;
    context?: string;
    idempotencyKey: string;
}

export type RedisConnection = string | IORedis;

export interface QueueStepExecutorOptions {
    /** Redis URL or an ioredis instance (with `maxRetriesPerRequest: null`). A URL is owned and closed by `close()`. */
    redis: RedisConnection;
    /** Queue name prefix. Default `flow`. */
    prefix?: string;
    /** Wait for a worker per step; on expiry the step fails. Default 900 000. */
    timeoutMs?: number;
    /** BullMQ retries of the same job (same idempotency key). Default 1: no retry, the engine owns retries. */
    attempts?: number;
    /**
     * How often to look at a job that has not reported back, in ms. BullMQ announces the end of a job through an event stream, and
     * an announcement that is made before a new `QueueEvents` has started reading is never delivered: a step that finishes within
     * milliseconds on the first use of a queue would then wait until `timeoutMs` for nothing. Looking at the job itself closes that
     * gap. Default 1000; 0 turns it off.
     */
    pollMs?: number;
}

function connect(redis: RedisConnection): { connection: IORedis; owned: boolean } {
    return typeof redis === 'string'
        ? { connection: new IORedis(redis, { maxRetriesPerRequest: null }), owned: true }
        : { connection: redis, owned: false };
}

/**
 * The BullMQ job id for a step's idempotency key. BullMQ forbids `:` in an id, so it is escaped; the escape is reversible, which
 * keeps two different keys from ever sharing an id (turning `:` into `_` made `a_b:c` and `a:b_c` the same job, and a step
 * would have received the result of another one).
 */
export function jobIdFor(idempotencyKey: string): string {
    return idempotencyKey.replace(/%/g, '%25').replace(/:/g, '%3A');
}

export function queueName(prefix: string, agentId: string): string {
    return `${prefix}.${agentId}`;
}

/** Resolves with the output (or rejects with the failure) of a job that finished without its event reaching us. Never settles once `state.stop` is set. */
async function pollFinished(queue: Queue<StepJobData, StepOutput>, id: string, everyMs: number, state: { stop: boolean }): Promise<StepOutput> {
    for (;;) {
        await new Promise<void>(r => { const t = setTimeout(r, everyMs); t.unref?.(); });
        if (state.stop) return new Promise<never>(() => undefined);
        const job = await queue.getJob(id).catch(() => undefined);
        if (!job) continue;
        if (await job.isCompleted().catch(() => false)) return job.returnvalue as StepOutput;
        if (await job.isFailed().catch(() => false)) throw new Error(job.failedReason || 'the job failed');
    }
}

export class QueueStepExecutor implements StepExecutor {
    private readonly connection: IORedis;
    private readonly owned: boolean;
    private readonly prefix: string;
    private readonly timeoutMs: number;
    private readonly attempts: number;
    private readonly pollMs: number;
    private readonly queues = new Map<string, { queue: Queue<StepJobData, StepOutput>; events: QueueEvents }>();

    constructor(opts: QueueStepExecutorOptions) {
        const c = connect(opts.redis);
        this.connection = c.connection;
        this.owned = c.owned;
        this.prefix = opts.prefix ?? DEFAULT_QUEUE_PREFIX;
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
        this.attempts = opts.attempts ?? 1;
        this.pollMs = opts.pollMs ?? 1000;
    }

    private ensure(agentId: string) {
        let entry = this.queues.get(agentId);
        if (!entry) {
            const name = queueName(this.prefix, agentId);
            entry = {
                queue: new Queue<StepJobData, StepOutput>(name, { connection: this.connection }),
                events: new QueueEvents(name, { connection: this.connection }),
            };
            this.queues.set(agentId, entry);
        }
        return entry;
    }

    async run(step: FlowStep, input: StepInput): Promise<StepOutput> {
        if (input.signal.aborted) throw new Error('step cancelled before it was queued');
        const { queue, events } = this.ensure(step.agent);
        const job = await queue.add('run', {
            step,
            prompt: input.prompt,
            context: input.context,
            idempotencyKey: input.idempotencyKey,
        }, {
            jobId: jobIdFor(input.idempotencyKey),
            attempts: this.attempts,
            removeOnComplete: 100,
            removeOnFail: 50,
        });

        // A cancelled run must not leave its step waiting for a worker: drop it if no worker took it yet.
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_, reject) => {
            onAbort = () => {
                job.remove().catch(() => undefined);
                reject(new Error('step cancelled'));
            };
            input.signal.addEventListener('abort', onAbort, { once: true });
        });
        const state = { stop: false };
        const polled = this.pollMs > 0 && job.id ? pollFinished(queue, job.id, this.pollMs, state) : new Promise<never>(() => undefined);
        try {
            return await Promise.race([job.waitUntilFinished(events, this.timeoutMs) as Promise<StepOutput>, polled, aborted]);
        } finally {
            state.stop = true;
            if (onAbort) input.signal.removeEventListener('abort', onAbort);
        }
    }

    async close(): Promise<void> {
        await Promise.all([...this.queues.values()].flatMap(e => [e.queue.close(), e.events.close()]));
        this.queues.clear();
        if (this.owned) this.connection.disconnect();
    }
}

export interface StepWorkerOptions {
    redis: RedisConnection;
    /** Agent ids this process serves, one queue each. */
    agents: string[];
    /** Runs a step in this process (a local agent executor). A throw fails the job and so the step. */
    executor: StepExecutor;
    prefix?: string;
    /** Steps at the same time per agent. Default 4. */
    concurrency?: number;
    onError?: (agentId: string, err: Error) => void;
}

export interface StepWorkers {
    close(): Promise<void>;
}

/** Serves `agents` queues with `executor`. The worker-side signal never aborts: a job runs to its end once taken. */
export function createStepWorker(opts: StepWorkerOptions): StepWorkers {
    const { connection, owned } = connect(opts.redis);
    const prefix = opts.prefix ?? DEFAULT_QUEUE_PREFIX;
    const workers = opts.agents.map(agentId => {
        const worker = new Worker<StepJobData, StepOutput>(
            queueName(prefix, agentId),
            job => opts.executor.run(job.data.step, {
                prompt: job.data.prompt,
                context: job.data.context,
                idempotencyKey: job.data.idempotencyKey,
                signal: new AbortController().signal,
            }),
            { connection, concurrency: opts.concurrency ?? 4 },
        );
        worker.on('error', err => opts.onError?.(agentId, err));
        return worker;
    });
    return {
        async close() {
            await Promise.all(workers.map(w => w.close()));
            if (owned) connection.disconnect();
        },
    };
}
