---
title: portfolio-advisor
description: Four agents that advise on and trade a portfolio, with a simulated market - identity, a signed power, approval by role and four eyes, a signed audit, a durable flow, MCP, the agent protocol and evaluations, all from the framework.
---

*Needs nothing: no key, no network. Lives in `examples/portfolio-advisor/`. 60 offline tests.*

The reference example for **governance and autonomy**. Four agents work on a portfolio whose market and broker are simulated; the numbers (the fusion of signals, the decision matrix, the rebalance) come from the design of a finance system. What the example shows is everything **around** the model: who each agent is, what it may do alone, who decides what it may not, and what can be proved afterwards.

| Agent | Does | Holds a power? |
|---|---|---|
| `analyst` | reads the portfolio and the fused signals, says what to consider | no: reading is not critical |
| `rebalancer` | computes the orders that restore the target allocation, sends nothing | no |
| `executor` | sends orders to the broker (`place_order`, destructive) | **yes**: up to 5,000 EUR and 100 shares per order |
| `orchestrator` | routes the request to the right specialist | no |

## Run it

```bash
cd examples/portfolio-advisor
npm install
npm run demo         # six scenes you can watch, and the proof of the audit
npm test             # 60 tests, offline
```

The model is **scripted**, so what you see is what the framework decides around it. The demo prints, for instance:

```
2. A small order (1,000 EUR, 20 shares) goes alone
   executor   place_order     → ALLOW  under the mandate of did:example:finance-department
3. An order of 6,000 EUR is above the limit: it asks, and ana (finance) approves
   ? asks ana: outside the mandate: the amount 6000 is above the 5000 the mandate allows
   executor   place_order     → ALLOW  beyond its mandate  approved by ana as finance
5. The same large order, but the one who answers is the intern: refused
   executor   place_order     → DENY  (invalid approval: approver "intern" does not have the role finance)
7. 15 entries, 15 signed by the agent that acted: the chain and every signature verify with the keys of the operator.
```

## How it works

**1. A tool says what it is; the framework decides.** No tool checks a limit or a role. It declares `readOnly` or `destructive`, and the [policy](../../concepts/policy/) reads that:

```ts
const placeOrder = defineTool({
    name: 'place_order',
    description: 'Send an order to the broker. It cannot be undone',
    destructive: true,
    input: z.object({ symbol: z.string(), side: z.enum(['buy', 'sell']), quantity: z.number(), amount: z.number(), currency: z.string() }),
    execute: async (order) => { broker.place(order); return `${order.side} ${order.quantity} ${order.symbol} for ${order.amount} ${order.currency}: done`; },
});
```

**2. Each agent is someone: its own key, its own identity.** The operator (not the framework) supplies the keys; the audit of every call is signed by the agent that made it ([identity](../../concepts/agent-identity/)):

```ts
const identities = ed25519AgentIdentities(Object.fromEntries(
    Object.entries(agentKeys).map(([id, k]) => [id, { id: `did:example:agent:${id}`, privateKey: k.privateKey }]),
));
```

**3. The power is a signed credential, and only for what is critical.** The finance department grants the executor a [mandate](../../concepts/mandates/): one action, two caps (one of them not money). The analyst, the rebalancer and the orchestrator hold none:

```ts
issueMandate({
    privateKey: issuer.privateKey, alg: 'EdDSA', issuer: ISSUER, id: 'm-executor-1',            // signed by the finance department
    subject: 'carlos', agent: 'executor', agentIdentity: identityOf('executor'),                // for Carlos, for the executor
    holderKey: agentKeys.executor.publicKey,                                                    // tied to the executor's key
    actions: ['place_order'],
    limits: {
        amount: { max: 5_000, currency: 'EUR' },
        measures: [{ name: 'shares', max: 100, unit: 'shares' }],                              // a cap that is not money
    },
    expiresAt,
});
```

**4. One policy ties it together.** It applies the mandate only to what is destructive, reads the amount and the shares from the call, and sends anything outside the power to a person **of the finance role**:

```ts
const policy = mandatePolicy({
    verifier: jwtMandateVerifier({ trustedIssuers, credentialFor: (request) => credentials[request.principal.agentId] }),
    appliesTo: (tool) => tool.destructive === true,            // reads and planning need no power
    measureOf: { shares: (args) => ({ value: args.quantity as number, unit: 'shares' }) },
    amountOf: (args) => ({ value: args.amount as number, currency: 'EUR' }),
    agentIdentity: identities, requireHolderBinding: true,      // a copy of the credential is useless without the key
    outOfScope: 'ask',
    outOfScopeApprover: { approverRoles: ['finance'] },
});
```

The engine gets that policy, the audit, the approver and the directory of people. The roles come from **your** directory, never from what the caller says:

```ts
const engine = createBaseEngine({
    /* providers, agents, tools ... */
    agentIdentity: identities, identity: { userId: 'carlos' },
    audit: new HashChainAuditSink('./audit.ndjson'),
    policy, approver, approverDirectory: directory, forbidSelfApproval: true,   // the roles come from YOUR directory
});
```

**5. The orchestrator hands work over; each specialist keeps its own identity.** `delegatesTo` and `ask_agent` do it, and the audit shows who asked and who acted:

```ts
{ id: 'orchestrator', allowedTools: [], delegatesTo: ['analyst', 'rebalancer', 'executor'] }
```

**6. The same pieces, in other places.**

- **A durable flow** (plan → execute with a human gate) that survives a restart: `parseFlow`, `runFlow`, `NdjsonRunJournal`, `FileApprovalStore`.
- **The signals as an MCP server** with its own identity and its own signed audit; the advisor consumes it with `mcpServers`, assigned to the analyst only, and **does not believe** the server's "read-only" unless you trust it:

```ts
mcpServers: [{ name: 'signals', url, mode: 'tools', assignTo: ['analyst'], headers: { Authorization: `Bearer ${token}` } }]
```

- **The advisor served over the agent protocol**, behind an identity gate that takes the person from a validated token, never from a header the caller sets:

```ts
gate: capabilityIdentityGate({
    name: 'advisor-service', agentIdentity: identities,
    identity: (call) => {
        const userId = tokens[String(call.headers['x-user-token'])];
        if (!userId) throw new Error('the run needs a person to act for');
        return { userId };
    },
}),
```

- **Evaluations** as data: cases, graders, a rate, and a `compare` that names what a worse configuration breaks:

```ts
{ id: 'an order above the money limit is not sent without a person', input: 'send this order',
  expect: [toolCalled('place_order'), executed(0)] }
```

## Read it for

- the [governance concepts](../../concepts/governance/) working together: identity, policy, mandate, approval, audit;
- an agent that is **autonomous inside a signed limit** and asks beyond it ([how much autonomy](../../concepts/autonomy/));
- the table in the example's README: each requirement, the framework primitive that implements it, and the **few lines the example had to write itself**;
- the findings it exposed in the framework, all fixed in the framework and not worked around: the record of an approval had no reason, flows and the tool server did not enforce roles, a mandate was asked for even to read.

Next: [aval-scheduler](../aval-scheduler/) is the other agent that spends money, autonomous and on a schedule.
