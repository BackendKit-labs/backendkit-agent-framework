# @backendkit-labs/agent-protocol

Agent HTTP protocol v1, for agents that call each other over the network. It has three parts:

- **`AgentServer`** publishes an agent's capabilities.
- **`AgentClient`** calls them, with retries and a circuit breaker.
- A control surface lets a supervisor (for example Hermes) pause, drain, budget, audit and steer an agent and its flows.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-protocol)](https://www.npmjs.com/package/@backendkit-labs/agent-protocol)

## Installation

```bash
npm install @backendkit-labs/agent-protocol
```

## Serving an agent

A capability is a named operation with an input and output schema and an `execute` function. Capabilities can run synchronously (the answer comes back in the same request) or asynchronously (the caller gets a `taskId` and polls).

```typescript
import { AgentServer } from '@backendkit-labs/agent-protocol';

const server = new AgentServer({
  name: 'invoice-agent',
  version: '1.0.0',
  description: 'Reconciles supplier invoices',
  port: 4100,
  host: '0.0.0.0',
  apiKey: process.env.AGENT_API_KEY,        // required off loopback (strict: true makes it mandatory)
  strict: true,
});

server.register({
  definition: {
    name: 'reconcile',
    description: 'Match an invoice against its purchase order',
    async: false,
    input:  { invoiceId: { type: 'string', required: true } },
    output: { matched: { type: 'boolean' }, differences: { type: 'array' } },
  },
  execute: async (input, context) => {
    const result = await reconcile(String(input.invoiceId), context.tenantId);
    context.reportCost?.(0.002);              // optional: travels back as costUsd
    return result;
  },
});

await server.start();
```

| Endpoint | What it does |
|---|---|
| `GET /v1/agent/health` | Liveness (no key needed) |
| `GET /v1/agent/info` | Name, version, capabilities, limits, flows, control actions |
| `POST /v1/agent/run` | Run a capability |
| `GET` / `DELETE /v1/agent/tasks/:id` | Poll or cancel an async run |
| `POST /v1/agent/control`, `GET /v1/agent/runs`, `GET /v1/agent/audit` | Control surface (separate key, see below) |
| `GET /v1/agent/approvals`, `GET /v1/agent/approvals/:id`, `POST /v1/agent/approvals/:id/decision` | Approvals waiting for a person (protocol 1.2, control key) |
| `GET /v1/agent/flows`, `POST /v1/agent/flows/:name/runs`, `GET /v1/agent/flow-runs/:id`, `POST /v1/agent/flow-runs/:id/:action` | Flows hosted by the agent (protocol 1.1) |

Every request except `health` needs `Authorization: Bearer <apiKey>` when `apiKey` is set. Answers use one envelope: `{ ok, data | error, meta }`, with stable error codes (`ErrorCode`).

## Calling an agent

```typescript
import { AgentClient } from '@backendkit-labs/agent-protocol';

const client = new AgentClient({
  url: 'http://invoice-agent:4100',
  apiKey: process.env.AGENT_API_KEY,
  tenantId: 'acme',
  timeout: 30_000,
  maxRetries: 3,              // transient errors: 5xx, 429, network (see idempotent below)
  circuitBreaker: true,       // default; or { failureThreshold: 50, minimumCalls: 5, ... }; false disables it
});

const info = await client.info();
const reply = await client.run('reconcile', { invoiceId: 'F-12' });            // { status: 'done', output, costUsd? }
const output = await client.runAndWait('long-report', { month: '2026-10' });   // runs async and polls until done
```

Other calls: `health()`, `poll(taskId)`, `cancel(taskId)`, `listRuns()`, `audit(query)`, `listFlows()`, `startFlow(name, input)`, `flowRun(id)`, `steerFlow(id, 'pause' | 'resume' | 'cancel')`, `getCircuitState()`.

`run(capability, input, { idempotent: true })` marks a run as safe to repeat. Without it, after a 5xx, a timeout or a dropped connection the first attempt may already have run (a payment, an email), so the call is not repeated and the error reaches you. A 429 is always retried, because the request was refused, not run.

## Control surface (protocol 1.1)

A supervisor that manages a fleet needs to act on an agent without being able to run its capabilities, and the reverse. So control uses its own key:

```typescript
import { AgentServer, ControlError } from '@backendkit-labs/agent-protocol';

const server = new AgentServer({
  ...opts,
  controlApiKey: process.env.AGENT_CONTROL_KEY,   // without it the control endpoints answer FORBIDDEN
  limits: { maxConcurrent: 4, budgetUsdPerDay: 20 },
  control: {
    actions: ['pause', 'set_budget', 'list_jobs', 'cancel_job'],
    control: async (action, params) => {
      if (action === 'set_budget') return budget.set(Number(params.usdPerDay));
      throw new ControlError('CONTROL_UNSUPPORTED', `not implemented: ${action}`);
    },
    audit: async (query) => auditLog.read(query),   // GET /v1/agent/audit
  },
});
```

`drain` and `resume` (stop and resume accepting runs) are built in. The available actions are `CONTROL_ACTIONS`: `pause`, `resume`, `drain`, `set_budget`, `get_sandbox_policy`, `set_sandbox_policy`, `list_jobs` and `cancel_job`. With a `flowHandler`, the server also starts, watches and steers the flows it hosts.

## Approvals (protocol 1.2)

A flow step (or a tool call) that needs a person stops, and the supervisor has to see it and answer. With an `approvalHandler` the server lists what waits and takes the decision. Like control, it needs the control key, because an approval carries the input and output of steps.

```typescript
import { createApprovalHandler, MemoryApprovalStore } from '@backendkit-labs/agent-core';

const store = new MemoryApprovalStore();            // or FileApprovalStore
const server = new AgentServer({
  ...opts,
  controlApiKey: process.env.AGENT_CONTROL_KEY,
  flowHandler,                                       // see createFlowHandler in agent-core
  approvalHandler: createApprovalHandler(store, {
    onDecided: approval => resumeFlow(approval),     // run the flow again with the same runId
  }),
});

// supervisor side
const client = new AgentClient({ url, apiKey, controlApiKey });
const pending = await client.listApprovals({ status: 'pending' });
await client.decideApproval(pending[0].id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, reason: 'ok' });
```

| Endpoint | |
|---|---|
| `GET /v1/agent/approvals?status=` | Pending, approved, rejected or executed |
| `GET /v1/agent/approvals/:id` | One approval: subject, reason, who may decide, outcome |
| `POST /v1/agent/approvals/:id/decision` | `{ decision: 'approve' \| 'reject', by: { kind, id }, reason? }` |

The host checks who decides: an approval that `accepts: ['human']` refuses an agent or a service, and the requester's own chain cannot approve it (`FORBIDDEN`, and the request stays open). A second decision for the same id is a `CONFLICT`. `AgentInfo` reports `approvals: true` and `protocolMinor`; flow runs can now be `awaiting_approval` or `lost` (a supervisor that restarted and no longer finds the run), and steps `awaiting_approval` or `interrupted`. A server older than 1.2 never sends them.

## Resilience helpers

The client's retry and circuit breaker are exported for reuse: `withRetry`, `CircuitBreaker`, `CircuitBreakerRegistry`, `CircuitBreakerOpenError` and `isHttpServerError`. They wrap `@backendkit-labs/retry` and `@backendkit-labs/circuit-breaker`.
