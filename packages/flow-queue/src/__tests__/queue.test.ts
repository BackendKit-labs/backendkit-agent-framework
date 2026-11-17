import type { FlowStep } from '@backendkit-labs/agent-core';

const adds: any[] = [];
let finish: (() => Promise<any>) | undefined;
let removed = 0;
const workerHandlers: { fn?: (job: any) => Promise<any>; opts?: any; name?: string }[] = [];

jest.mock('ioredis', () => ({ Redis: jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })) }));
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation((name: string) => ({
        name,
        add: jest.fn(async (_n: string, data: any, opts: any) => {
            adds.push({ name, data, opts });
            return { remove: async () => { removed++; }, waitUntilFinished: () => finish!() };
        }),
        close: jest.fn(async () => undefined),
    })),
    QueueEvents: jest.fn().mockImplementation(() => ({ close: jest.fn(async () => undefined) })),
    Worker: jest.fn().mockImplementation((name: string, fn: any, opts: any) => {
        workerHandlers.push({ name, fn, opts });
        return { on: jest.fn(), close: jest.fn(async () => undefined) };
    }),
}));

import { QueueStepExecutor, createStepWorker } from '../index';

const step = { id: 's1', agent: 'writer', prompt: 'p' } as unknown as FlowStep;
const input = (signal = new AbortController().signal) => ({ prompt: 'hi', context: 'c', idempotencyKey: 'r:s1:1', signal });

beforeEach(() => { adds.length = 0; removed = 0; workerHandlers.length = 0; });

describe('QueueStepExecutor', () => {
    it('enqueues on flow.<agent> with the idempotency key as job id and returns the output', async () => {
        finish = async () => ({ content: 'done' });
        const ex = new QueueStepExecutor({ redis: 'redis://x' });
        await expect(ex.run(step, input())).resolves.toEqual({ content: 'done' });
        expect(adds[0].name).toBe('flow.writer');
        expect(adds[0].opts.jobId).toBe('r_s1_1');
        expect(adds[0].opts.attempts).toBe(1);
        expect(adds[0].data).toMatchObject({ prompt: 'hi', context: 'c', idempotencyKey: 'r:s1:1' });
        await ex.close();
    });

    it('propagates a worker failure', async () => {
        finish = async () => { throw new Error('boom'); };
        const ex = new QueueStepExecutor({ redis: 'redis://x' });
        await expect(ex.run(step, input())).rejects.toThrow('boom');
    });

    it('rejects and removes the job when the run is cancelled', async () => {
        finish = () => new Promise(() => undefined);
        const ex = new QueueStepExecutor({ redis: 'redis://x', prefix: 'q' });
        const ac = new AbortController();
        const p = ex.run(step, input(ac.signal));
        await new Promise(r => setImmediate(r));
        ac.abort();
        await expect(p).rejects.toThrow('cancelled');
        expect(removed).toBe(1);
        expect(adds[0].name).toBe('q.writer');
    });

    it('does not enqueue when already cancelled', async () => {
        const ac = new AbortController(); ac.abort();
        await expect(new QueueStepExecutor({ redis: 'redis://x' }).run(step, input(ac.signal))).rejects.toThrow('cancelled');
        expect(adds).toHaveLength(0);
    });
});

describe('createStepWorker', () => {
    it('serves one queue per agent and runs the step through the executor', async () => {
        const run = jest.fn(async () => ({ content: 'ok', costUsd: 1 }));
        const w = createStepWorker({ redis: 'redis://x', agents: ['a', 'b'], executor: { run }, concurrency: 2 });
        expect(workerHandlers.map(h => h.name)).toEqual(['flow.a', 'flow.b']);
        expect(workerHandlers[0].opts.concurrency).toBe(2);
        const out = await workerHandlers[0].fn!({ data: { step, prompt: 'hi', context: 'c', idempotencyKey: 'k' } });
        expect(out).toEqual({ content: 'ok', costUsd: 1 });
        expect(run).toHaveBeenCalledWith(step, expect.objectContaining({ prompt: 'hi', idempotencyKey: 'k' }));
        await w.close();
    });
});
