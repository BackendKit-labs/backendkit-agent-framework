---
title: Governance
description: Policy, approvers, durable approvals and audit - the layer that decides which tool calls may run, outside the model.
---

An agent that can act on real systems needs a layer that is **not** the model deciding what is allowed. In this framework that layer is configuration of the engine: a policy, an approver, an approval store and an audit sink.

## The decision for every call

Before a tool runs, a **policy** answers one of three things:

| Effect | Meaning |
|---|---|
| `allow` | Run it. It can carry a mode: `dry_run` (the tool simulates and writes nothing) or `sandboxed`. |
| `ask` | Someone has to approve first. It can say who may: `accepts: ['human']`. |
| `deny` | Do not run it. The model is told why. |

A policy sees the **principal** (the agent, its delegation chain, the tenant, the user, the roles) and the **call** (the tool with its declared facts, and the arguments).

```ts
import type { ToolPolicy } from '@backendkit-labs/agent-core';

const rules: ToolPolicy = {
  decide(principal, call) {
    if (call.tool.name === 'pay_invoice' && (call.args.amount as number) > 10_000) {
      return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'] };
    }
    return { effect: 'allow' };
  },
};
```

Several policies combine with the rule **deny beats ask beats allow**. A policy that throws denies.

Without a policy of your own, but with someone to ask, the default applies: read-only tools run, destructive tools ask a person, anything that declares nothing asks.

## Who answers an ask

An **approver** answers right away: a person at a terminal (`consoleApprover()`), another agent (`agentApprover(...)`), a UI, a service. Approvals are **checked before they count**:

- its kind must be one the `ask` accepts (an agent cannot satisfy `accepts: ['human']`);
- nobody approves their own request, nor one from their delegation chain;
- an agent only approves what it could do itself.

## When nobody can answer now: durable approvals

Give the engine an **approval store**. The `ask` is saved as pending, the model is told the call did not run, and whoever decides later (a UI, a CLI, another process) resolves it, and the call runs once:

```ts
const approvals = new FileApprovalStore('./approvals');
const engine = createBaseEngine({ /* ... */ approvals });

await engine.run('pay the October invoices');                  // asks become pending requests

const [req] = await approvals.list({ status: 'pending' });
await approvals.resolve(req.id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
await engine.runApproved(req.id);                              // runs once; a second call throws
```

`FileApprovalStore` allows exactly one decision and one execution per request, even across processes sharing the directory. `runApproved` repeats every check.

## Audit

Each tool call, accepted or refused, produces **one audit event**, with the arguments as a SHA-256 only (no sensitive values in the log). `HashChainAuditSink` writes them chained, so removing or editing a line is detectable.

```ts
createBaseEngine({ /* ... */ audit: new HashChainAuditSink('./audit.log') });
```

## Why outside the model

A model can be talked into things. A policy cannot. If the rule is "payments over 10k need a human", it lives in `decide`, not in the prompt, and it holds whatever the model says or is told.

Build one: [govern a payment tool](../../guides/govern-a-payment-tool/).
