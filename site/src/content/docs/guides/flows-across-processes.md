---
title: Flows across processes
description: Put the steps of a flow on BullMQ workers and keep the runs in Redis, so any process can resume a run.
---

**Goal:** an orchestrator process that runs a flow, with its steps executed by workers in other processes (or machines), and a run any process can pick up.

You need a Redis. For a throwaway one:

```bash
docker run --rm -p 6379:6379 redis:7
```

```bash
npm install @backendkit-labs/agent-flow-queue @backendkit-labs/agent-core
```

## The orchestrator

The engine stays in one process. Only the **steps** travel.

```ts
import { loadFlow, runFlow } from '@backendkit-labs/agent-core';
import { QueueStepExecutor, RedisRunJournal } from '@backendkit-labs/agent-flow-queue';

const redis = process.env.REDIS_URL!;
const executor = new QueueStepExecutor({ redis, timeoutMs: 15 * 60_000 });
const journal = new RedisRunJournal({ redis });

const result = await runFlow(await loadFlow('flows/close-month.yaml'), {
  executor, journal, runId: 'close-2026-10', payload: { month: '2026-10' },
});
await executor.close();
```

## A worker

One queue per agent, `flow.<agent>`. A worker takes the steps of the agents it names, `concurrency` at a time.

```ts
import { createStepWorker } from '@backendkit-labs/agent-flow-queue';

const workers = createStepWorker({
  redis: process.env.REDIS_URL!,
  agents: ['sales', 'finance'],
  concurrency: 4,
  executor: { run: async (step, input) => ({ content: await localAgent(step.agent).run(input.prompt) }) },
});
// on shutdown: await workers.close();
```

Run as many workers as you like, on as many machines as you like. Each takes what its agents handle.

## Things to know before you rely on it

- **At least once.** The job id is the step's idempotency key (`runId:stepId:attempt`), so enqueuing the same step twice is one job. But a worker may run a step twice (a crash after the work, before the ack). A step with an external effect (a payment, an email) must use `input.idempotencyKey` itself.
- **Retries belong to the engine,** not to BullMQ.
- **Cancel.** Aborting the run removes a step no worker has taken yet; a step already running finishes.
- **Deadlines.** `timeoutMs` per step (default 15 minutes). On expiry the step fails like any failed step.
- **A claim, not a lock.** One process holds a run at a time. If it dies, the claim expires by its Redis TTL and another process resumes.
- **Environments.** `prefix` lets several environments share one Redis.

## One machine?

If everything runs on one host you do not need Redis. `NdjsonRunJournal` keeps one file per run, and a run whose owner died is taken over at once. Redis is for several machines.

Reference: the [`agent-flow-queue` page](../../packages/flow-queue/).
