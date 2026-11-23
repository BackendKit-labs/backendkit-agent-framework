---
title: Run control
description: Limit how long an agent runs, step through it by hand, and let a supervisor change a running engine from outside.
---

Two kinds of control, for two different people:

- **Limits and steps** decide how many iterations one run may take and who is asked to continue. They are options of the engine and are for whoever builds the agent.
- **Control from outside** lets a supervisor (an operator, a fleet manager) read and change a running engine: its sandbox policy, its jobs, its audit trail. It is for whoever operates the agent.

## Limits and steps

One run of the engine is a loop: the model answers, asks for tools, the tools run, the model answers again. Each pass is an **iteration**. Left alone, a confused model can loop for a long time and spend money, so the loop is bounded. There are three modes, set with `iterationMode`:

| Mode | What happens | Use it for |
|---|---|---|
| `interactive` (default) | Runs up to `maxIterations` (100), then **asks** `onIterationLimit`. `true` adds 25 more iterations, `false` stops. With no callback it stops. | A person is watching: a terminal, a chat |
| `auto` | Runs without asking, up to the hard cap of **1000 iterations**. | Unattended agents: services, schedules, [autonomous agents](../../agents/autonomous/) |
| `step-by-step` | After every iteration (from the second on) it calls `onStep`. `true` continues, `false` stops. | Debugging, demos, a person who approves each move |

The hard cap of 1000 holds in every mode: no answer to a callback goes past it.

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  // ...providers, agents, tools
  iterationMode: 'interactive',
  maxIterations: 20,
  onIterationLimit: async (stats) => {
    console.log(`${stats.iterations} iterations, ${stats.toolCalls} tool calls, ${stats.elapsedMs} ms`);
    return askPerson('Keep going?');          // true: +25 iterations; false: stop
  },
});
```

In `auto` mode set `maxIterations` too (it is the run's own limit) and add a cost limit as a second guard (see [observability and cost](../observability-and-cost/)): iterations count loops, not money.

The callbacks receive `stats`:

| Field | What |
|---|---|
| `iterations` | Iterations done in this run |
| `maxIterations` | The limit in force now (it grows by 25 each time you continue) |
| `globalLimit` | The hard cap, 1000 |
| `totalIncrements` | How many times the limit was extended |
| `toolCalls` | Tool calls made |
| `elapsedMs` | Time since the run started |

When a run stops because a callback said `false` (or there was none), the result still comes back with what happened: the tool calls made and any text produced so far.

### Step by step

```ts
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  // ...
  iterationMode: 'step-by-step',
  onStep: async (stats) => {
    console.log(`step ${stats.iterations}`);
    return (await prompt('Continue? (y/n) ')) === 'y';
  },
});
```

The first iteration runs without asking, because there is nothing to judge yet.

`IterationManager` is the class behind this. You use it directly only to build your own loop; its `advance()` returns whether to go on, and `setMode` and `setMaxIterations` change it between runs.

## Control from outside

A supervisor needs to act on a running agent **without being able to run its capabilities**, so control is a separate surface with its own key. `createEngineControl(engine, options)` builds the handler; an `AgentServer` plugs it in as `control`:

```ts
import { createEngineControl, createJobRegistry } from '@backendkit-labs/agent-core';
import { sandboxPolicyControl } from '@backendkit-labs/agent-sandbox';
import { AgentServer } from '@backendkit-labs/agent-protocol';

const control = createEngineControl(engine, {
  policy: sandboxPolicyControl(service.policy, { ceiling: { preset: 'auto-edit' } }),
  jobs,                                            // the registry the engine runs with
  approveWidening: async (req) => askOperator(req),
  onAudit: entry => auditLog.write(entry),
});

const server = new AgentServer({
  ...options,
  gate,                                            // required: who runs capabilities and for whom
  controlApiKey: process.env.AGENT_CONTROL_KEY,    // without it, control answers FORBIDDEN
  control,
});
```

`control.actions` lists what this engine supports, built from what you passed:

| Action | Needs | What it does |
|---|---|---|
| `get_sandbox_policy` | `policy` | Returns the policy in force and its `version`. |
| `set_sandbox_policy` | `policy` | Changes it (rules below). |
| `list_jobs` | `jobs` | Lists the [background jobs](../background-jobs/) of every agent, or of one `owner`. |
| `cancel_job` | `jobs` | Cancels a job by id. |

An action the engine does not support answers `CONTROL_UNSUPPORTED`. (`pause`, `resume`, `drain` and `set_budget` belong to the server, see [agent-protocol](../../packages/agent-protocol/).)

### Changing the policy: narrowing is free, widening needs a person

A `set_sandbox_policy` request is judged against the policy in force:

| The request is... | Result |
|---|---|
| Invalid | `INVALID_INPUT` |
| Wider than the operator's `ceiling` | `POLICY_WIDER_THAN_PARENT`. **No approval can grant it.** |
| Narrower, or equal | Applied. Narrowing never asks. |
| Wider, but within the ceiling | Asks `approveWidening`. With no approver, or if it says no, `APPROVAL_REQUIRED`: control never widens on its own say-so. |

`expectedVersion` in the request makes it fail if the policy changed since the supervisor read it, so two supervisors do not overwrite each other. Changes run one at a time.

### The audit trail

Every control action and every sandbox decision of the engine is recorded: who asked (`by`, or the tenant), what, the outcome, and the policy `version` in force afterwards. `control.audit({ since, limit })` reads it (the last 1000 entries are kept), and `onAudit` receives each entry as it is recorded, so you can persist it: a failing `onAudit` never blocks control. Call `control.dispose()` when the engine goes away.

```ts
const entries = await control.audit({ since: '2026-11-22T00:00:00Z', limit: 50 });
// [{ ts, kind: 'control', tool: 'cancel_job', agentId, outcome: 'cancelled', by: 'ana', ... }]
```

To read the policy rules themselves, and how a policy is written, see [sandboxed agents](../../agents/sandboxed/).
