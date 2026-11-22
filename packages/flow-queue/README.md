# @backendkit-labs/agent-flow-queue

Run [`agent-core` flows](../core/README.md#flows--declarative-and-durable) across processes: a BullMQ `StepExecutor` (each step runs on a worker, maybe on another machine) and a Redis `RunJournal` (a run survives the process and any process can resume it).

```bash
npm install @backendkit-labs/agent-flow-queue @backendkit-labs/agent-core
```

Needs a Redis. The flow engine stays in one process; only the steps travel.

## A complete example: steps on workers, and a run that resumes

One file. A flow whose steps travel through Redis to workers, with the run kept in a Redis journal. The first attempt of the last step fails, like a crashed worker; the second `runFlow` call, with the same `runId`, resumes and runs **only** what was not done. The worker and the orchestrator share one file here so the example is one piece; in production each is its own process.

Start a Redis (any Redis 6+ works; this one is thrown away when stopped):

```bash
docker run -d --rm --name flow-redis -p 6379:6379 redis:7-alpine
npm install @backendkit-labs/agent-core @backendkit-labs/agent-flow-queue
npm install -D typescript tsx
```

Save the program as `queue.ts` and run it with `REDIS_URL=redis://127.0.0.1:6379 npx tsx queue.ts`:

```ts
import { parseFlow, runFlow } from '@backendkit-labs/agent-core';
import { QueueStepExecutor, RedisRunJournal, createStepWorker } from '@backendkit-labs/agent-flow-queue';

const redis = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const prefix = `demo-${Date.now()}`;               // an own namespace, so this demo never touches other queues

const flow = parseFlow(`
flow: close-month
trigger: { type: manual }
steps:
  - id: collect-sales
    agent: sales
    prompt: "Collect the sales of {{payload.month}}"
  - id: collect-costs
    agent: finance
    prompt: "Collect the costs of {{payload.month}}"
  - id: report
    agent: finance
    prompt: "Write the report"
    after: [collect-sales, collect-costs]
`);

// WORKER side. In production this is its own process (maybe on another machine), one per kind of work.
// Here it lives in the same file so the example is one piece. It records who ran what.
const handled: string[] = [];
let failReport = true;                                 // the first attempt of "report" dies, like a crashed worker
const workers = createStepWorker({
  redis, prefix, agents: ['sales', 'finance'], concurrency: 2,
  executor: {
    run: async (step, input) => {
      if (step.id === 'report' && failReport) throw new Error('worker crashed');
      handled.push(step.id);
      return { content: `${step.agent} did ${step.id} (${input.prompt})` };
    },
  },
});

// ORCHESTRATOR side: the flow engine runs here, only the steps travel through Redis.
const executor = new QueueStepExecutor({ redis, prefix, timeoutMs: 30_000 });
const journal = new RedisRunJournal({ redis, prefix });
const options = { executor, journal, payload: { month: '2026-10' }, runId: 'close-2026-10' };

const first = await runFlow(flow, options);
console.log('first run :', first.status, handled);

failReport = false;                                    // the worker is back
const second = await runFlow(flow, options);           // same runId: it resumes
console.log('second run:', second.status, handled);

const run = await journal.get('close-2026-10');
console.log(run?.status, Object.entries(run?.steps ?? {}).map(([id, s]) => `${id}:${s.status}`).join(' '));

await workers.close();
await executor.close();
await journal.close();
```

It prints (the two collect steps run in parallel, so their order may swap):

```text
first run : failed [ 'collect-costs', 'collect-sales' ]
second run: completed [ 'collect-costs', 'collect-sales', 'report' ]
done collect-sales:done collect-costs:done report:done
```

What happened:

1. **Steps travel, the engine stays.** `runFlow` runs in the orchestrator. For each step, `QueueStepExecutor` puts a job in the queue `<prefix>.<agent>` (here `sales` and `finance`), and a worker created with `createStepWorker` takes it, runs its `executor`, and sends the result back. The two collect steps ran at once, on different queues.
2. **`report` failed on the worker**, and the flow ended `failed`. The journal in Redis kept the two finished steps.
3. **The second `runFlow` with the same `runId` resumed.** It read the run from Redis, saw the two collect steps `done`, and sent only `report` to a worker. `handled` shows each collect step once.
4. **`prefix` isolates.** The demo uses its own prefix, so it cannot touch the queues of anything else in that Redis. Use a fixed prefix per environment (`prod`, `staging`) in your program.

To turn it into a real deployment, split the file in two and keep the same `redis` and `prefix` in both:

- **Worker process** (as many as you need, on any machine): only the `createStepWorker` part, with the executor that runs your real agent. On shutdown call `await workers.close()`.
- **Orchestrator process:** the `QueueStepExecutor`, the `RedisRunJournal` and `runFlow`. If it dies, start it again with the same `runId`: the run resumes from the journal, and steps that were already running on workers are not sent twice (the job id is the step's idempotency key).
- **A step with an external effect** (a payment, an email) must use `input.idempotencyKey` inside the worker's executor, because the queue is at least once.

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
- **A lost announcement is not a lost step.** BullMQ announces the end of a job through an event stream, and an announcement made before a new `QueueEvents` has started reading is never delivered. The executor also looks at the job itself every `pollMs` (default 1 s; 0 turns it off), so a step that finishes in milliseconds on the first use of a queue does not wait for `timeoutMs`.
- **Names.** `prefix` (default `flow`) lets several environments share a Redis.

## A run that survives the process

```typescript
import { RedisRunJournal } from '@backendkit-labs/agent-flow-queue';

const journal = new RedisRunJournal({ redis: process.env.REDIS_URL!, prefix: 'flow' });
await runFlow(flow, { executor, journal, runId: 'close-2026-10', payload });   // run again with the same runId to resume
```

One Lua script per mutation makes "create only if absent", "append only if it exists" and "take the claim only if free or mine" atomic. The claim expires by Redis TTL, and releasing with an old token never frees a renewed claim. Logs do not expire on their own: delete finished runs with your own retention job.

> The scripts are covered by a contract suite that runs against a real Redis when `localhost:6379` answers (`REDIS_HOST`, `REDIS_PORT`) and against an in-memory stand-in otherwise.
