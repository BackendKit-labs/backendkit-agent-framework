---
title: A durable flow with an approval
description: Run a flow that stops for a person, resume it after the decision, and see that finished steps are not run again.
---

**Goal:** a month-close flow whose `report` step needs a person. Run it, see it stop, approve, run again, see it finish without repeating the work.

## The flow

`close-month.yaml`:

```yaml
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
    agent: analyst
    prompt: "Write the month report"
    after: [collect-sales, collect-costs]
    gate: { approval: human }
  - id: publish
    agent: comms
    prompt: "Send the report"
    after: [report]
```

## The program

The executor here is a stub that records which steps ran; in a real flow it would run an agent.

```ts
import { readFileSync } from 'node:fs';
import { parseFlow, runFlow, stepApprovalId, MemoryRunJournal, MemoryApprovalStore } from '@backendkit-labs/agent-core';

const flow = parseFlow(readFileSync('close-month.yaml', 'utf8'));
const store = new MemoryApprovalStore();
const journal = new MemoryRunJournal();
const ran: string[] = [];

const options = {
  executor: { run: async (step: { id: string; agent: string }) => { ran.push(step.id); return { content: `${step.agent} did ${step.id}` }; } },
  payload: { month: '2026-10' },
  journal,
  approvals: { store },
  runId: 'close-2026-10',
};

const first = await runFlow(flow, options);
console.log(first.status, ran);
// awaiting_approval [ 'collect-sales', 'collect-costs' ]

await store.resolve(stepApprovalId('close-2026-10', 'report'), {
  decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString(),
});

const second = await runFlow(flow, options);
console.log(second.status, ran);
// completed [ 'collect-sales', 'collect-costs', 'report', 'publish' ]
```

## What happened

1. **Parallel start.** `collect-sales` and `collect-costs` have no `after`, so they ran together.
2. **The gate.** `report` is gated on a human. The run stopped as `awaiting_approval`, and `publish` did not start.
3. **The decision.** The approval id of a step is `stepApprovalId(runId, stepId)`. A person (or a UI) resolves it.
4. **Resume.** Calling `runFlow` again with the **same `runId`** read the journal. The two collect steps were `done`, so they were **not run again**: the `ran` list shows each id once.

## Make it survive the process

`MemoryRunJournal` lives in memory. To survive a crash, change one line:

```ts
import { NdjsonRunJournal, FileApprovalStore } from '@backendkit-labs/agent-core';

const journal = new NdjsonRunJournal('./.flows');                  // one file per run
const approvals = { store: new FileApprovalStore('./.approvals') };
```

Kill the process while a step runs, start it again with the same `runId`, and the run takes up where it stopped. A run owned by a process that died is taken over immediately.

## Next

- A condition on a step: `when: { step: report, contains: "APPROVED" }`.
- Cap how many steps of a kind run at once with a `KeyedConcurrencyLimiter`.
- Put the steps on workers: [flows across processes](../flows-across-processes/).
