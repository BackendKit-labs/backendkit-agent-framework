---
title: The engine and tools
description: What the engine does in a turn, and how tools declare what they do so the engine can decide what to allow.
---

## A turn

`engine.run(question)` runs a loop until the model answers without asking for a tool, or until `maxIterations`:

1. Send the conversation and the tools the agent may use to the model.
2. If the model asks for tools, check each call (allowed tools, argument guardrails, [policy](../governance/)), run it, add the result to the conversation, go to 1.
3. Otherwise the answer is final.

What comes back is a `RunResult`:

| Field | Meaning |
|---|---|
| `text` | What the agent said at the end. |
| `toolCalls` | Every tool call of the turn, in order: `name`, `success`, `errorCode`, a `preview` of the result. |
| `errors` | The messages of the error events of the turn. |
| `aborted`, `budgetExceeded` | The turn was stopped by the caller or by a cost budget. |

Assert on `toolCalls`, not on the model's words. A model can say "Order placed" without placing anything; `toolCalls` says what happened.

## Tools

```ts
import { defineTool, z } from '@backendkit-labs/agent-core';

const readFile = defineTool({
  name: 'read_file',
  description: 'Read a text file inside the project',
  readOnly: true,
  input: z.object({ path: z.string().describe('Path relative to the project') }),
  execute: async ({ path }, ctx) => { /* ... */ return '...'; },
});
```

- The **schema** validates the arguments before `execute` runs. A wrong call from the model becomes an error the model can read and correct.
- The **description** and each `.describe()` are the only documentation the model has. Write them for the model.
- `execute` returns a **string**. Return JSON with `JSON.stringify` when the model needs structure.
- `ctx` carries the abort signal, the agent id, the session and who is acting. Pass `ctx.signal` to anything cancellable (`fetch`, a child process) so a stopped turn stops the work.
- A thrown error reaches the model as a message, not as a crash. Throw a `ToolError` to give it a code and a hint.

### Declared facts

| Flag | Says | The engine does |
|---|---|---|
| `readOnly: true` | Changes nothing. | Runs it without asking. Implies safe to run in parallel with other read-only tools. |
| `destructive: true` | Cannot be undone (pay, delete, send). | Asks a person, always. Cannot be combined with `readOnly`. |
| `idempotent: true` | Calling twice is the same as once. | Safe to retry. |

A tool that declares nothing is treated as "may change things": it asks. This is deliberate: forgetting a fact asks too much, never too little.

## Agents

An `AgentProfile` is an identity and a list: `id`, `name`, `systemPrompt`, and `allowedTools`, the names of the tools this agent may call. A tool that is registered but not in `allowedTools` is invisible to that agent. With several agents, `delegatesTo` says which others it may ask for help ([multi-agent](../multi-agent/)).

## Putting it together

`createBaseEngine` takes the providers, the agents, the tools and a transport, and builds the engine:

```ts
const engine = createBaseEngine({
  providers: { main: provider }, defaultProvider: 'main',
  agents: [assistant], defaultAgent: 'assistant',
  tools: [readFile], transport,
  workingDir: process.cwd(),
  iterationMode: 'auto',     // run until the model is done
  maxIterations: 24,         // but never forever
  maxParallelTools: 4,       // read-only calls of one turn may run together
});
```

`maxParallelTools` above 1 lets the model's read-only calls of a single turn run at the same time. Calls that are not read-only always run one after another.

The transport receives the events of the turn (text, tool calls, results, errors). `StdoutTransport` prints, `CallbackTransport` calls your function, and the testkit's `mockTransport` records them for assertions.
