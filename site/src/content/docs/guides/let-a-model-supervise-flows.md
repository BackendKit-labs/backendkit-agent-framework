---
title: Let a model supervise flows
description: Give an agent the flows as tools - start several, wait, read results - while it cannot approve or cancel on its own.
---

**Goal:** an agent you can ask "are alpha and beta ready?" that starts the checks, waits for them and explains the results, and that **cannot** approve the final report or cancel a run without a person.

This is how the `release-captain` agent is built (see [the example](../../examples/release-captain/)).

## 1. Host the flows

`flowFromDefinition` makes a flow definition controllable; `createFlowHandler` hosts a set of them.

```ts
import { createFlowHandler, flowFromDefinition, NdjsonRunJournal, FileApprovalStore } from '@backendkit-labs/agent-core';

const journal = new NdjsonRunJournal('./state/runs');
const store = new FileApprovalStore('./state/approvals');

const { handler } = createFlowHandler({
  alpha: flowFromDefinition(alphaFlow, { executor: alphaExecutor, journal, approvals: { store } }),
  beta:  flowFromDefinition(betaFlow,  { executor: betaExecutor,  journal, approvals: { store } }),
});
```

All runs share one journal and one store. The `flowRunId` a supervisor sees is the id of the journal and of the approval of a gated step (`stepApprovalId(flowRunId, stepId)`).

## 2. Turn them into tools

```ts
import { createFlowTools, createApprovalHandler } from '@backendkit-labs/agent-core';

const flowTools = createFlowTools({
  flows: handler,
  approvals: createApprovalHandler(store),
  approver: { kind: 'service', id: 'captain' },       // decisions are made as a service
});
```

You get `flow_list`, `flow_start`, `flow_status`, **`flow_wait`**, `flow_pause`, `flow_resume`, `flow_cancel`, `approval_list`, `approval_get` and `approval_decide`.

- **`flow_wait`** blocks until a run stops running (or the timeout, up to 60 s) in **one call**. Without it the model polls `flow_status`, a model turn per look.
- `approval_decide` decides as the configured `approver`, **whatever the model says**. A `service` cannot satisfy an approval that accepts only `human`, so it gets `FORBIDDEN`.

## 3. Say what it may do alone

```ts
import type { ToolPolicy } from '@backendkit-labs/agent-core';

const policy: ToolPolicy = {
  decide(_principal, call) {
    const name = call.tool.name;
    if (name === 'approval_decide') return { effect: 'deny', reason: 'only a person decides an approval' };
    if (name === 'flow_cancel') return { effect: 'ask', reason: 'cancelling cannot be undone', accepts: ['human'] };
    return { effect: 'allow' };
  },
};
```

With a `policy` set, tools that are neither `readOnly` nor declared would ask, so the policy allows `flow_start`, `flow_pause` and `flow_resume` explicitly: that is the agent's job.

Two layers stop approval: the policy denies the call, and even without it the tool would be refused. Defence in depth, both tested.

## 4. The engine

```ts
const engine = createBaseEngine({
  providers: { main: provider }, defaultProvider: 'main',
  agents: [captainProfile], defaultAgent: 'captain',
  tools: [...flowTools, ...yourOwnTools],
  transport, workingDir: process.cwd(), iterationMode: 'auto', maxIterations: 24,
  maxParallelTools: 6,                 // several flow_wait in one turn run together
  policy,
  approver: confirmCancelWithAPerson,
});
```

## 5. The prompt does the choreography

The profile's prompt tells the model how to work: start **all** the runs first and then wait; wait with `flow_wait`, never poll; read the result before explaining; stop at an approval and say who has to decide; cancel only when asked. Governance holds even if it ignores this; the prompt makes it efficient.

## What it looks like with a real model

Asked to check two monorepos (one with a failing build), a real model made 6 calls and about 0.008 USD: it listed the flows, started both runs **before** waiting, waited with `flow_wait`, read both results, said the first was sound and waiting for a person (with the run and approval ids) and the second had failed at `build-util` with its compiler error.

The approval itself happens outside the model: a person approves, then asks the agent to resume, and the run goes on **without redoing** what was done.
