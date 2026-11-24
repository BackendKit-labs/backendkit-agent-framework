---
title: release-captain
description: Is this monorepo ready to release? A durable flow built from the package graph, and an agent a model drives.
---

**The question:** *is this npm monorepo ready to publish?* It is the checklist a person does by hand: build in dependency order, check version ranges, see what changed since each package's last tag, ask the registry, check the tarballs, plan the publication. `release-captain` runs it as a flow whose **shape is the shape of the monorepo**. It publishes nothing.

```
inspect ─┐
tags ────┤                              ┌─ pack-core ┐
registry-core … ───────────────────────┐│            │
build-core ─> build-util ─> build-web ─> build-cli    ├─> plan ─> verify ─> report
   └──────────> build-docs (private)    └─ pack-… ────┘            │       (when ok; a person approves)
build-solo ─────────────────────────────  blocked ──> report skipped
```

## As an app

```bash
npm run smoke                                   # 19 checks: a small monorepo on disk, real git, real processes
npm run release -- ../../agent-framework --jobs 3
npm run release -- ../../agent-framework --run <id> --approve
```

| In the flow | Framework piece |
|---|---|
| The definition is **generated from the package graph**; a build waits for the builds it needs | `FlowDefinition`, `validateFlow` |
| Real subprocesses; cancel and deadline **kill the process tree** | `StepExecutor`, the step `signal`, `timeoutMs` |
| At most N builds at once | `KeyedConcurrencyLimiter` keyed by agent |
| A failed build **skips what depends on it** and the rest finish | default failure handling |
| A run of minutes **survives the process** and resumes | `NdjsonRunJournal`, `runId` |
| The report runs only if the plan is sound, and a person reads it first | `when`, `gate.approval: human`, `FileApprovalStore` |
| The one that checks is not the one that planned | the verifier recomputes the order from the graph |

Run against the framework's own repository (17 packages, real `npm` builds and registry): 150 s, 52 steps, none failed, the repo left clean. The verdict was *blocked*, correctly: the checked-out branch had code in `agent-core` that was not released and the version had not been raised.

## As an agent

On top of the same flows there is an **agent**: a model you ask *"can I publish alpha and beta?"*. It decides what to do with the flows as tools.

```bash
npm run agent:smoke    # 6 checks, offline, a deterministic model drives real flows
npm run agent:live     # a real model (DeepSeek), two monorepos, a spend cap
```

What a real model did (6 model calls, about 0.008 USD, 16 s): listed the flows, **started both runs before waiting**, waited with `flow_wait`, read both results and answered that one was sound and waiting for a person, and the other had failed at `build-util` with its compiler error, which had skipped everything that depended on it.

| The agent | Framework piece |
|---|---|
| Flows as tools; several runs at once under one cap of builds | `createFlowHandler`, `createFlowTools`, a shared `KeyedConcurrencyLimiter` |
| Waits in one call, not by polling | `flow_wait` |
| **Cannot approve the report**: the policy denies it, and the tool decides as a `service`, which a `human` approval refuses | `ToolPolicy`, `createApprovalHandler`, `accepts: ['human']` |
| Cannot cancel a run unless a person confirms | `destructive`, `policy`, `approver` |
| The run waits for a person as `awaiting_approval`, with one id for the model, the journal and the approval; after the decision it goes on without rebuilding | `flowFromDefinition` + `FlowHost`, `NdjsonRunJournal` |

The rule that matters is a **policy**, outside the model: the captain does its job alone, a cancellation needs a person, and deciding an approval is never allowed, whatever the model says:

```ts
export const captainPolicy: ToolPolicy = {
    decide(_principal, call) {
        const name = call.tool.name;
        if (name === 'approval_decide') return { effect: 'deny', reason: 'only a person decides an approval' };
        if (name === 'flow_cancel') return { effect: 'ask', reason: 'cancelling a run cannot be undone', accepts: ['human'] };
        return { effect: 'allow' };
    },
};
```

How to build one: [let a model supervise flows](../../guides/let-a-model-supervise-flows/).

## What it found in the framework

- Killing a cancelled run's builds with a synchronous `taskkill` blocked the whole process.
- A `gate.approval: human` flow hosted in `FlowHost` ended `failed` instead of waiting, and its approval id was unknowable. **Fixed in the framework** (`FlowAwaitingApproval`, a shared run id).
- A supervising model polled `flow_status`. **Added to the framework:** `flow_wait`.
