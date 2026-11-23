---
title: Assistants
description: Conversational agents with a few typed tools - the simplest kind, and the base of every other. A complete example you can run offline.
---

An **assistant** answers questions and uses a handful of tools to do it: look something up, read a record, draft a message. It runs when a person talks to it and stops when it answers.

## A complete assistant

One file. It answers customers about their orders, has a cost limit, and runs **offline** because a scripted model plays the conversation. Save it as `assistant.ts`:

```bash
npm install @backendkit-labs/agent-core @backendkit-labs/agent-providers
npm install -D @backendkit-labs/agent-testkit typescript
```

```ts
import { createBaseEngine, defineTool, z, type AgentProfile, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

// 1. A tool: what the agent can do. It only looks something up, so it is declared read-only.
const orderStatus = defineTool({
  name: 'order_status',
  description: 'Look up the status of an order by its number',
  readOnly: true,
  input: z.object({ orderId: z.string().describe('The order number, for example A-1001') }),
  execute: async ({ orderId }) => JSON.stringify({ orderId, status: 'shipped', eta: '2 days' }),
});

// 2. An agent: who it is and which tools it may use.
const support: AgentProfile = {
  id: 'support',
  name: 'Support',
  icon: '💬',
  description: 'Answers customers about their orders',
  systemPrompt: 'You help customers with their orders. Use order_status; never guess a status.',
  allowedTools: ['order_status'],
};

// 3. An engine. The scripted model plays one conversation, so this runs offline.
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  providers: {
    mock: scriptedProvider([
      { tool_calls: [{ id: 'c1', name: 'order_status', args: { orderId: 'A-1001' } }] },
      { content: 'Your order A-1001 has shipped and arrives in 2 days.' },
    ]),
  },
  defaultProvider: 'mock',
  agents: [support],
  defaultAgent: 'support',
  tools: [orderStatus],
  transport: mockTransport().transport,
  workingDir: process.cwd(),
  iterationMode: 'auto',
  maxIterations: 8,
  // Stop a run that costs more than 10 cents (prices in dollars per million tokens: use your model's).
  observability: { costTracker: { inputPricePerMToken: 0.3, outputPricePerMToken: 1.2, budget: { perRun: 0.1 } } },
  abortOnBudget: true,
});

const result = await engine.run('Where is my order A-1001?');
console.log(result.text);                                        // Your order A-1001 has shipped and arrives in 2 days.
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`)); // [ 'order_status:true' ]
console.log(result.budgetExceeded ?? false);                     // false
```

Run it with Node 24 (`node assistant.ts`) or `npx tsx assistant.ts`. What the model said is in `result.text`; **what it did** is in `result.toolCalls`. Check the second one in tests.

### With a real model

Change only the provider and the transport. Everything else stays:

```ts
import { StdoutTransport, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

// in createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ... })
providers: { main: new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }) },
defaultProvider: 'main',
transport: new StdoutTransport(),
```

The scaffolder gives you the same shape:

```bash
npm create bk-agent@latest my-assistant      # choose the "single" architecture
```

## What makes an assistant good

- **Few, sharp tools.** A model chooses better among five clearly described tools than among thirty.
- **Read-only where you can.** Declare `readOnly: true` on tools that look things up: they run without asking and in parallel.
- **A budget.** Set a cost limit per run, as above, so a loop cannot run up a bill ([cost and observability](../../concepts/observability-and-cost/)).
- **Memory, if it should remember.** Session history is kept; for facts across sessions use [memory](../../concepts/memory-and-learning/).
- **A test that does not need a model.** The scripted provider above is the test: see [test an agent](../../guides/test-an-agent/).

## Put it in front of people

| You want | Use |
|---|---|
| A terminal chat | `StdoutTransport` (or `CallbackTransport`) in your own script |
| A browser chat | [`agent-web`](../services/) serves it over WebSocket; `agent-web-ui` gives you a React chat |
| It callable from Claude, an IDE or another agent | [serve it over MCP](../services/) |

## When it grows

An assistant that needs to change things gets [governance](../../concepts/governance/). One that needs many specialities becomes a [team of agents](../../concepts/multi-agent/). One that should act without being asked becomes an [autonomous agent](../autonomous/).
