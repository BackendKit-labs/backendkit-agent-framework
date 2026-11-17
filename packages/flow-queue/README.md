# @backendkit-labs/agent-flow-queue

BullMQ `StepExecutor` for `runFlow` (SPEC-0023 D5): each step runs on a worker, maybe in another process.

```ts
// orchestrator process
const executor = new QueueStepExecutor({ redis: process.env.REDIS_URL! });
await runFlow(flow, { executor });

// worker process (one queue flow.<agent> each)
createStepWorker({ redis, agents: ["writer"], executor: localExecutor, concurrency: 4 });
```

At-least-once: job id = `runId:stepId:attempt`; steps with external effects must use `input.idempotencyKey`.
Cancelling the run removes a step no worker took yet. Default wait 900 s per step (`timeoutMs`).
