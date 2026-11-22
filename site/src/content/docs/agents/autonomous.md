---
title: Autonomous agents
description: Agents that run without being asked - on a schedule, on an event or on a webhook - and how to keep them safe when nobody is watching.
---

An **autonomous agent** is started by something other than a person typing: a clock, an event in your system, a call from another service. Nobody is watching, which is why governance, budgets and audit matter more here than anywhere else.

## One agent, three triggers

`createAutonomousAgent` takes the same options as `createBaseEngine`, plus a list of `triggers`. This one watches deployments: it summarizes failures every weekday at nine, reacts to a signed webhook from your CI, and reacts to an event your own code emits. It runs offline with a scripted model.

```ts
import { createAutonomousAgent, defineTool, z, type AgentProfile } from '@backendkit-labs/agent-core';
import { scriptedProvider } from '@backendkit-labs/agent-testkit';

const note = defineTool({
  name: 'note',
  description: 'Write a note for the on-call person',
  input: z.object({ text: z.string() }),
  execute: async ({ text }) => { console.log('NOTE:', text); return 'noted'; },
});

const monitor: AgentProfile = {
  id: 'monitor', name: 'Monitor', icon: '📟', description: 'Watches deployments',
  systemPrompt: 'When something fails, write one note with note.',
  allowedTools: ['note'],
};

const agent = createAutonomousAgent({
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'n1', name: 'note', args: { text: 'payment-api 2.1.4 failed' } }] },
    { content: 'Noted.' },
  ]) },
  defaultProvider: 'mock',
  agents: [monitor],
  defaultAgent: 'monitor',
  tools: [note],
  workingDir: process.cwd(),
  iterationMode: 'auto',
  policy: { decide: () => ({ effect: 'allow' }) },     // the note is harmless; a real agent decides per tool
  goal: 'Watch deployments and tell the on-call person when one fails',
  webhookPort: 3187,
  triggers: [
    { type: 'schedule', cron: '0 9 * * 1-5', task: "Summarize yesterday's failed deployments." },
    { type: 'webhook', path: '/hooks/deploy', secret: process.env.CI_WEBHOOK_SECRET ?? 'dev-secret',
      buildPrompt: body => `A deployment failed: ${JSON.stringify(body)}` },
    { type: 'event', topic: 'deployment.failed', buildPrompt: payload => `Investigate: ${JSON.stringify(payload)}` },
  ],
});

await agent.start();                                          // cron, webhook server and event listeners are on
agent.emit('deployment.failed', { service: 'payment-api' });  // fires the event trigger
// ... on shutdown:
process.on('SIGTERM', () => agent.stop());
```

- **Schedule:** a five-field cron expression and the prompt to run. `timezone` (IANA) is optional.
- **Webhook:** the `secret` is the one you give to your CI (GitHub style). The server checks `X-Hub-Signature-256`, an HMAC of the raw body, and answers `401` without it; it answers `202` at once and the run continues in the background. A route needs a `secret` or an explicit `allowUnsigned: true`, so you cannot expose one by forgetting it. A query string (`/hooks/deploy?source=ci`) still matches the route.
- **Event:** `agent.emit(topic, data)` for events from your own code. Anything in the process can also use the shared `EventBus` (`EventBus.emit(topic, { source, data })`).

A failing handler never takes the process down: an error in a run is reported and the agent keeps listening.

## From a server: cron, webhooks and queues

When the agent lives behind `agent-web`, a `TriggerBus` runs a fresh engine per trigger: on a cron schedule, on an incoming webhook, or for each job of a BullMQ queue.

```ts
import { TriggerBus } from '@backendkit-labs/agent-web';

const triggers = new TriggerBus(engineFactory)
  .addCron({
    name: 'health-check',
    schedule: '*/15 * * * *',
    buildPrompt: () => 'Check all API endpoints and report any that are down.',
    onComplete: ({ output }) => { if (output.includes('DOWN')) pagerduty.alert(output); },
  })
  .addWebhook({
    name: 'github-pr',
    path: '/webhooks/github',
    secret: process.env.GITHUB_SECRET,            // verified as an HMAC over the raw body
    buildPrompt: body => `Review PR #${(body as any).pull_request.number}`,
    onComplete: ({ output }) => github.comment(output),
  });
```

A webhook answers immediately and the run continues in the background, so use `onComplete` for the result.

## Make unattended runs safe

Nobody is there to say yes, so an irreversible action must **wait**: not run, and not block. This agent refunds small amounts by itself and stores the large ones as pending until a person answers, even days later. It runs offline:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBaseEngine, defineTool, z, FileApprovalStore, MemoryAuditSink,
  type AgentProfile, type ToolPolicy,
} from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const refund = defineTool({
  name: 'refund', description: 'Refund a customer', destructive: true,
  input: z.object({ orderId: z.string(), amount: z.number() }),
  execute: async ({ orderId, amount }) => `refunded ${amount} on ${orderId}`,
});
const desk: AgentProfile = { id: 'desk', name: 'Desk', icon: '🏦', description: 'Refunds', systemPrompt: 'Refund when asked.', allowedTools: ['refund'] };

// Small refunds run; large ones wait for a person.
const rules: ToolPolicy = {
  decide: (_principal, call) => (Number(call.args.amount) > 100
    ? { effect: 'ask', reason: 'refund above 100', accepts: ['human'] }
    : { effect: 'allow' }),
};

const approvals = new FileApprovalStore(mkdtempSync(join(tmpdir(), 'approvals-')));  // use a real folder: it must outlive the process
const audit = new MemoryAuditSink();                                                  // HashChainAuditSink('audit.log') in production

const engine = createBaseEngine({
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'r1', name: 'refund', args: { orderId: 'A-9', amount: 450 } }] },
    { content: 'Waiting for approval.' },
  ]) },
  defaultProvider: 'mock', agents: [desk], defaultAgent: 'desk', tools: [refund],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
  policy: rules, approvals, audit,
});

// The run does not block: the ask is stored and the model is told the call has NOT run.
const result = await engine.run('Refund 450 on order A-9');
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`));   // [ 'refund:false' ]

// Later, in another process: a person answers, and the engine runs exactly that call, once.
const [pending] = await approvals.list({ status: 'pending' });
await approvals.resolve(pending!.id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
console.log(await engine.runApproved(pending!.id));                  // refunded 450 on A-9
```

| Concern | What to use |
|---|---|
| It must not spend without limit | A cost budget per run that stops the turn ([cost and observability](../../concepts/observability-and-cost/)) |
| It must not do the irreversible alone | The policy and the durable approvals above. They can also [expire](../../concepts/governance/#approvals-that-expire) and require a [role](../../guides/govern-a-payment-tool/#6-who-may-approve) |
| An approver that never answers | `approverTimeoutMs` on a live approver, so one silent person does not hold every other approval ([governance](../../concepts/governance/#an-approver-that-does-not-answer)) |
| You must be able to reconstruct what it did | An audit sink: one record per call, chained and optionally signed |
| A long process must not be lost | A [flow](../../concepts/flows/) with a journal |
| A slow tool that may still be running | After `toolTimeoutMs` the model is told the call may still be running, so it checks before repeating a write |

The `autonomous` architecture of `create-bk-agent` scaffolds a project with cron, webhook and event triggers.
