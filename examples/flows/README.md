# flows

A business flow as data: a YAML file, run by `runFlow` with a journal, a human approval and a resume. No LLM and no network: the executor is scripted, so you see the engine and nothing else.

```bash
npm run build -w packages/core        # from the repository root, once
node examples/flows/run.mjs
```

```
first run : awaiting_approval | ran: collect-costs, collect-sales
pending   : [ 'close-2026-10-report' ]
second run: completed | ran: report, publish
report    : [analyst] Write the month report for Acme
```

What it shows:

1. `close-month.yaml`: two collectors with no `after` (they run together), a `report` that waits for both and needs a person (`gate.approval: human`), a `publish`, and a compensation if `publish` fails.
2. The first run stops as `awaiting_approval`; the collectors are done and written to the journal.
3. A person decides through `createApprovalHandler` (over HTTP this is `POST /v1/agent/approvals/:id/decision`).
4. The second run uses the same `runId`: the collectors are **not** run again, it continues with `report` and `publish`.

To use it for real, replace the executor with one that calls your agents (or with `QueueStepExecutor` from [`agent-flow-queue`](../../packages/flow-queue) to run each step on a worker), and `NdjsonRunJournal` with `RedisRunJournal` if several processes share the runs.
