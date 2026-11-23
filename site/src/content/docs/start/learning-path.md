---
title: Learning path
description: Six steps from a first agent to one you can trust in production. Each step runs offline, builds on the last and links to the page that goes deeper.
---

The framework is large. You do not need all of it: you need these six things, in this order. Every example on this page runs with **no API key and no network** (a scripted model plays the LLM), and the project's CI compiles and runs them, so what you copy works.

| Step | You learn | Time |
|---|---|---|
| [1. A first agent](#1-a-first-agent) | A tool, a profile and an engine | 10 min |
| [2. Rules in code](#2-rules-in-code) | A policy and an approver decide what runs, not the prompt | 15 min |
| [3. Test it](#3-test-it) | Prove those rules without a model | 10 min |
| [4. Two agents](#4-two-agents) | One agent hands work to another | 10 min |
| [5. Remember](#5-remember) | Knowledge that outlives a run | 10 min |
| [6. See what it did](#6-see-what-it-did) | An audit trail that says who acted and for whom | 10 min |

Set up once: `npm install @backendkit-labs/agent-core @backendkit-labs/agent-testkit`.

## The idea behind every step

An agent here is **a model that proposes and an engine that decides**. The model asks for a tool; before it runs, the engine asks three questions:

1. **Who acts?** The agent has a digital *identity*.
2. **For whom?** Every run names the person it acts on behalf of (`identity.userId`).
3. **Is this allowed?** A *policy* answers yes, no or "ask a person", and the answer does not depend on what the model says.

With no identity or no person, **nothing runs**, and the error says how to fix it. That is why every example below has two lines you will see again and again:

```text
agentIdentity: selfAssertedIdentities(),   // who the agent is
identity: { userId: 'me' },                // on whose behalf it acts
```

`selfAssertedIdentities()` is for development: the agent names itself, and the audit records that nobody vouched for it (`self-asserted`). In production an identity service gives the agent a real one. See [Governance](../../concepts/governance/).

## 1. A first agent

Build an assistant with one tool, first with a scripted model and then with a real one: [Your first agent](../first-agent/). Come back when `result.toolCalls` shows `get_weather:true`.

**What to notice:** the tool is a typed function the engine runs, not the model. The model only asks.

## 2. Rules in code

A tool that moves money should not run just because the model asked. This one pays invoices: up to 10,000 alone, above that a person has to say yes. The rule is a function, not a sentence in the prompt.

```ts
import { createBaseEngine, defineTool, selfAssertedIdentities, z, type AgentProfile, type ToolPolicy } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

export const pay = defineTool({
  name: 'pay_invoice',
  description: 'Pay an invoice',
  destructive: true,                                   // a payment cannot be undone
  input: z.object({ invoiceId: z.string(), amount: z.number() }),
  execute: async ({ invoiceId }) => `paid ${invoiceId}`,
});

export const treasurer: AgentProfile = {
  id: 'treasurer', name: 'Treasurer', icon: '💰', description: 'Pays invoices',
  systemPrompt: 'Pay the invoices you are asked to pay.',
  allowedTools: ['pay_invoice'],
};

// Small payments run; large ones ask a person.
export const rules: ToolPolicy = {
  decide(_principal, call) {
    if (call.tool.name === 'pay_invoice' && (call.args.amount as number) > 10_000) {
      return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'] };
    }
    return { effect: 'allow' };
  },
};

// Something has to answer an "ask". Here a person who always says no.
const approver = {
  ref: { kind: 'human' as const, id: 'ana' },
  request: async () => ({
    decision: 'reject' as const,
    by: { kind: 'human' as const, id: 'ana' },
    reason: 'too much',
    at: new Date().toISOString(),
  }),
};

/** An engine whose scripted model always asks to pay `amount`: whatever the model wants, the policy decides. */
export function buildEngine(amount: number) {
  return createBaseEngine({
    agentIdentity: selfAssertedIdentities(),   // who the agent is
    identity: { userId: 'me' },                // on whose behalf it acts
    providers: { mock: scriptedProvider([
      { tool_calls: [{ id: 'p', name: 'pay_invoice', args: { invoiceId: 'INV-1', amount } }] },
      { content: 'done' },
    ]) },
    defaultProvider: 'mock', agents: [treasurer], defaultAgent: 'treasurer', tools: [pay],
    transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
    policy: rules, approver,
  });
}
```

Run it for a small and a large payment:

```ts
import { buildEngine } from './treasury';

for (const amount of [500, 25_000]) {
  const result = await buildEngine(amount).run('pay INV-1');
  console.log(amount, result.toolCalls.map(c => `${c.name}:${c.success}`));
}
// 500 [ 'pay_invoice:true' ]      allowed by the policy
// 25000 [ 'pay_invoice:false' ]   a person was asked and said no: the tool never ran
```

**What to notice:** the model asked to pay both times. Only the policy made the difference. **Go deeper:** [Govern a payment tool](../../guides/govern-a-payment-tool/) adds who may approve and four eyes.

## 3. Test it

Because the model is scripted, a test of your rules is deterministic: no key, no network, no flakiness. This one uses only `node:assert`, so it works under any test runner.

```ts
import assert from 'node:assert/strict';
import { buildEngine } from './treasury';

const small = await buildEngine(500).run('pay INV-1');
assert.deepEqual(small.toolCalls.map(c => [c.name, c.success]), [['pay_invoice', true]]);

const large = await buildEngine(25_000).run('pay INV-1');
assert.deepEqual(large.toolCalls.map(c => [c.name, c.success]), [['pay_invoice', false]]);

console.log('ok: small payments run, large ones need a person');
```

**What to notice:** you tested the *rule*, which is what has to hold even when the model misbehaves. **Go deeper:** [Test an agent](../../guides/test-an-agent/) covers failures with a mock LLM server and evaluations.

## 4. Two agents

An agent whose profile has `delegatesTo` can hand a sub-task to another through `ask_agent`. The specialist owns the tool; the orchestrator owns none and only decides who answers.

```ts
import { createBaseEngine, defineTool, selfAssertedIdentities, z, type AgentProfile } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const invoiceTotal = defineTool({
  name: 'invoice_total', description: 'Total of an invoice', readOnly: true,
  input: z.object({ invoiceId: z.string() }),
  execute: async ({ invoiceId }) => `Invoice ${invoiceId}: 1,250.00 EUR`,
});

const billing: AgentProfile = {
  id: 'billing', name: 'Billing', icon: '🧾', description: 'Answers questions about invoices',
  systemPrompt: 'You answer questions about invoices. Use invoice_total.',
  allowedTools: ['invoice_total'],
};
const orchestrator: AgentProfile = {
  id: 'orchestrator', name: 'Orchestrator', icon: '🧭', description: 'Routes each request to a specialist',
  systemPrompt: 'Route each request to the right specialist with ask_agent, then give the answer to the customer.',
  allowedTools: [],
  delegatesTo: ['billing'],
};

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agents are
  identity: { userId: 'me' },                // on whose behalf they act
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'a1', name: 'ask_agent', args: { agent_id: 'billing', question: 'What is the total of invoice INV-7?' } }] },
    { tool_calls: [{ id: 'b1', name: 'invoice_total', args: { invoiceId: 'INV-7' } }] },
    { content: 'The total is 1,250.00 EUR.' },                // billing answers the orchestrator
    { content: 'Invoice INV-7 comes to 1,250.00 EUR.' },       // the orchestrator answers the customer
  ]) },
  defaultProvider: 'mock', agents: [orchestrator, billing], defaultAgent: 'orchestrator',
  tools: [invoiceTotal], transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
});

const result = await engine.run('How much is invoice INV-7?');
console.log(result.text);                                          // Invoice INV-7 comes to 1,250.00 EUR.
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`));  // [ 'invoice_total:true', 'ask_agent:true' ]
```

**What to notice:** `result.toolCalls` includes the specialist's call, so a test can prove the right agent did the work. A delegation is a call like any other, so a policy can allow or deny it. **Go deeper:** [Several agents](../../concepts/multi-agent/) explains when a *flow*, where you decide the path, fits better.

## 5. Remember

An agent forgets everything between runs unless you give it memory. Here a fact is stored once and appears in the prompt of a later run that asks about it.

```ts
import { createBaseEngine, createMemorySystem, selfAssertedIdentities, type AgentProfile } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const memory = createMemorySystem({
  episodic: { provider: 'in-memory' },     // 'json' with a path keeps it on disk
  semantic: { provider: 'in-memory' },
  procedural: { provider: 'in-memory' },
});
await memory.semantic.index('The refund window is 30 days from delivery.');

const support: AgentProfile = {
  id: 'support', name: 'Support', icon: '🎧', description: 'Answers customers',
  systemPrompt: 'Answer customers.',
  allowedTools: [],
};
const provider = scriptedProvider([{ content: 'You have 30 days.' }]);

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is
  identity: { userId: 'me' },                // on whose behalf it acts
  providers: { mock: provider }, defaultProvider: 'mock', agents: [support], defaultAgent: 'support', tools: [],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
  memorySystem: memory,
});

await engine.run('How long is the refund window?');
const seen = JSON.stringify(provider.calls[0]);
console.log('the model was given the stored fact:', seen.includes('30 days from delivery'));   // true
```

**What to notice:** nothing in the prompt mentions the refund window. The engine found the fact in memory and added it. **Go deeper:** [Memory and learning](../../concepts/memory-and-learning/) covers the three layers, and how repeated failures become lessons that a person approves.

## 6. See what it did

Before an agent works for real people, you want a record of **who did what, for whom, and whether it was allowed**. Give the engine an audit sink and every call leaves an event.

```ts
import { createBaseEngine, MemoryAuditSink, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { pay, treasurer, rules } from './treasury';

const audit = new MemoryAuditSink();
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is
  identity: { userId: 'ana' },               // on whose behalf it acts
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'p', name: 'pay_invoice', args: { invoiceId: 'INV-2', amount: 900 } }] },
    { content: 'done' },
  ]) },
  defaultProvider: 'mock', agents: [treasurer], defaultAgent: 'treasurer', tools: [pay],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
  policy: rules, audit,
});

await engine.run('pay INV-2');

for (const e of audit.events) {
  console.log(`${e.tool}: ${e.decision}, acted for ${e.principal.userId}, as ${e.agentIdentity?.id} (${e.agentIdentity?.assurance})`);
}
// pay_invoice: allow, acted for ana, as urn:agent:treasurer (self-asserted)
```

**What to notice:** the event names the identity and the person, and says the identity was `self-asserted`: nobody vouched for it. In production, an identity service gives the agent a real identity and every event is signed by it, so the record can be checked later by someone who does not trust you. **Go deeper:** [Governance](../../concepts/governance/) covers signed audit, mandates (a power of representation: what the agent may do for a person, with limits) and external identity services.

## Where to go from here

| You want to | Read |
|---|---|
| Serve the agent to a browser, other agents or Claude | [Kinds of agents: services](../../agents/services/) |
| Run steps that survive a restart, with a person's approval in the middle | [Flows](../../concepts/flows/) and [a durable flow with approval](../../guides/durable-flow-with-approval/) |
| Connect it to your tools over MCP | [MCP](../../concepts/mcp/) |
| Cap cost and see what each run spent | [Observability and cost](../../concepts/observability-and-cost/) |
| Start from a ready project | [Quickstart](../quickstart/) or the [agent designer](../agent-designer/) |
