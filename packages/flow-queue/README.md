# @backendkit-labs/agent-flow-queue

Run [`agent-core` flows](../core/README.md#flows--declarative-and-durable) across processes: a BullMQ `StepExecutor` (each step runs on a worker, maybe on another machine) and a Redis `RunJournal` (a run survives the process and any process can resume it).

```bash
npm install @backendkit-labs/agent-flow-queue @backendkit-labs/agent-core
```

Needs a Redis. The flow engine stays in one process; only the steps travel.

## Run steps on workers

```typescript
// orchestrator process
import { loadFlow, runFlow } from '@backendkit-labs/agent-core';
import { QueueStepExecutor } from '@backendkit-labs/agent-flow-queue';

const executor = new QueueStepExecutor({ redis: process.env.REDIS_URL!, timeoutMs: 15 * 60_000 });
const result = await runFlow(await loadFlow('flows/close-month.yaml'), { executor, payload: { month: '2026-10' } });
await executor.close();
```

```typescript
// worker process: one queue `flow.<agent>` each, `concurrency` steps at a time
import { createStepWorker } from '@backendkit-labs/agent-flow-queue';

const workers = createStepWorker({
  redis: process.env.REDIS_URL!,
  agents: ['sales', 'finance'],
  concurrency: 4,
  executor: { run: async (step, input) => ({ content: await localAgent(step.agent).run(input.prompt) }) },
});
// on shutdown: await workers.close();
```

- **At least once.** The job id is the step's idempotency key (`runId:stepId:attempt`), so enqueuing the same step twice is one job. A step with an external effect (payment, email) must use `input.idempotencyKey` in the worker too.
- **Retries belong to the engine.** `attempts` is 1 by default; BullMQ retries of the same job keep the same key.
- **Cancel.** Aborting the run removes a step no worker has taken yet; one already running finishes (the worker's signal never aborts).
- **Deadline.** `timeoutMs` (default 900 s) per step; on expiry the step fails and the flow handles it like any failed step.
- **Names.** `prefix` (default `flow`) lets several environments share a Redis.

## A run that survives the process

```typescript
import { RedisRunJournal } from '@backendkit-labs/agent-flow-queue';

const journal = new RedisRunJournal({ redis: process.env.REDIS_URL!, prefix: 'flow' });
await runFlow(flow, { executor, journal, runId: 'close-2026-10', payload });   // run again with the same runId to resume
```

One Lua script per mutation makes "create only if absent", "append only if it exists" and "take the claim only if free or mine" atomic. The claim expires by Redis TTL, and releasing with an old token never frees a renewed claim. Logs do not expire on their own: delete finished runs with your own retention job.

> The scripts are covered by a contract suite that runs against a real Redis when `localhost:6379` answers (`REDIS_HOST`, `REDIS_PORT`) and against an in-memory stand-in otherwise.
