---
title: flows
description: A business process as data, run with a journal, a human approval and a resume. No model and no network, so you see the engine and nothing else.
---

*No model. Needs only Node. Lives in `examples/flows/` of the monorepo.*

A flow is a process written as a YAML file. `runFlow` runs it, writes everything to a **journal**, stops at a human approval and, when run again with the same id, **continues where it stopped** without repeating what already ran.

## Run it

```bash
npm run build -w packages/core     # from the repository root, once
node examples/flows/run.mjs
```

```
first run : awaiting_approval | ran: collect-sales, collect-costs
pending   : [ 'close-2026-10-report' ]
second run: completed | ran: report, publish
report    : [analyst] Write the month report for Acme
```

The first run stops at the approval. A person decides. The second run uses the same run id, so the two collectors are **not** run again.

## How it works

**1. The process is data.** Two collectors run together (no `after`), the report waits for both and for a person, and a compensation says what to do if publishing fails:

```yaml
flow: close-month
trigger: { type: manual }
steps:
  - id: collect-sales          # no `after`: runs in parallel with collect-costs
    agent: sales
    prompt: "Collect the sales of {{payload.month}} for {{payload.company}}"
  - id: collect-costs
    agent: finance
    prompt: "Collect the costs of {{payload.month}} for {{payload.company}}"
    timeoutMs: 60000
  - id: report
    agent: analyst
    prompt: "Write the month report for {{payload.company}}"
    after: [collect-sales, collect-costs]
    gate: { approval: human }  # stops here until a person decides
  - id: publish
    agent: comms
    prompt: "Send the approved report to the board"
    after: [report]
compensation:
  - on: publish.failed
    agent: comms
    prompt: "Tell the board the report is delayed"
```

**2. The executor is the only piece that knows how to run a step.** Here it is a function that records the call; in a real system it would be an agent, a remote worker or a queue:

```js
const executor = {
  async run(step, input) {
    calls.push(step.id);
    return { content: `[${step.agent}] ${input.prompt}` };
  },
};
```

**3. State is durable.** A journal and an approval store, and a `runId` that names the run:

```js
const journal = new NdjsonRunJournal(await mkdtemp(join(tmpdir(), 'flows-')));
const approvals = { store: new MemoryApprovalStore() };
const options = { executor, journal, approvals, runId: 'close-2026-10', payload: { company: 'Acme', month: '2026-10' } };

const first = await runFlow(flow, options);          // collectors run, `report` stops for a person
```

**4. A person decides, and the same call continues.**

```js
const handler = createApprovalHandler(approvals.store);
await handler.decide(stepApprovalId(runId, 'report'), {
  decision: 'approve', by: { kind: 'human', id: 'ana' }, reason: 'numbers match',
});

const second = await runFlow(flow, options);         // same runId: finished steps are not run again
```

## Read it for

- a [flow as data](../../concepts/flows/): steps, `after`, `gate`, `compensation`;
- a journal that makes a run survive the process, and a **resume** that repeats nothing;
- an approval as a separate step in time: [the guide](../../guides/durable-flow-with-approval/) explains each line;
- what comes next: [audit-desk](../audit-desk/) runs the same idea across processes on a real Redis.
