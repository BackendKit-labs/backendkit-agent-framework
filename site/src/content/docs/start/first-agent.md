---
title: Your first agent
description: A tool, an agent profile and an engine, in about 40 lines - first offline, then with a real model.
---

We build an assistant with one tool. First with a **scripted model** so it runs offline and always gives the same answer; then we swap in a real one.

```bash
mkdir my-first-agent && cd my-first-agent
npm init -y
npm install @backendkit-labs/agent-core @backendkit-labs/agent-providers
npm install -D @backendkit-labs/agent-testkit tsx typescript
```

## 1. A tool

A tool is a name, a description the model reads, a typed input and a function. The input is a [Zod](https://zod.dev) schema (`z` is re-exported by the framework).

```ts
import { defineTool, z } from '@backendkit-labs/agent-core';

export const weather = defineTool({
  name: 'get_weather',
  description: 'Current weather for a city',
  readOnly: true,                       // it changes nothing: the engine may run it without asking
  input: z.object({ city: z.string().describe('City name') }),
  execute: async ({ city }) => `Weather in ${city}: sunny, 22 C`,
});
```

`readOnly: true` is a fact you declare. Leave it out and the tool would count as "may change things", which the engine treats with more caution. [Governance](../../concepts/governance/) explains why.

Here the tool is **LLM-controlled**: the model decides when to call it. The same tool can also be called **deterministically, with no model**, by your code or by an MCP client: see [one tool, two ways to run it](../../concepts/engine-and-tools/#one-tool-two-ways-to-run-it).

## 2. An agent profile

A profile is who the agent is and which tools it may use.

```ts
import type { AgentProfile } from '@backendkit-labs/agent-core';

export const assistant: AgentProfile = {
  id: 'assistant',
  name: 'Assistant',
  icon: '🤖',
  description: 'Answers questions',
  systemPrompt: 'You are a helpful assistant. Use the tools when they help.',
  allowedTools: ['get_weather'],
};
```

## 3. An engine, with a scripted model

`createBaseEngine` assembles the engine from a flat options object. The scripted provider plays a fixed conversation: first the model asks for the tool, then it answers.

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { weather } from './tool';
import { assistant } from './agent';

const engine = createBaseEngine({
  providers: {
    mock: scriptedProvider([
      { tool_calls: [{ id: 'c1', name: 'get_weather', args: { city: 'London' } }] },
      { content: 'It is sunny in London, 22 C.' },
    ]),
  },
  defaultProvider: 'mock',
  agents: [assistant],
  defaultAgent: 'assistant',
  tools: [weather],
  transport: mockTransport().transport,
  workingDir: process.cwd(),
  iterationMode: 'auto',
  maxIterations: 8,
});

const result = await engine.run("What's the weather in London?");
console.log(result.text);                                          // It is sunny in London, 22 C.
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`));  // [ 'get_weather:true' ]
```

Run it with `npx tsx index.ts`. `result.toolCalls` is the list of tools the model called and whether each one worked. You will use it a lot in tests.

## 4. A real model

Replace the provider and the transport. A transport is where the engine sends what happens (tokens, tool calls); `StdoutTransport` prints it.

```ts
import { createBaseEngine, StdoutTransport } from '@backendkit-labs/agent-core';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

const engine = createBaseEngine({
  providers: { main: new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }) },
  defaultProvider: 'main',
  agents: [assistant],
  defaultAgent: 'assistant',
  tools: [weather],
  transport: new StdoutTransport(),
  workingDir: process.cwd(),
  iterationMode: 'auto',
  maxIterations: 8,
});

await engine.run("What's the weather in London?");
```

`OpenAICompatibleProvider` covers OpenAI and any compatible API, `OllamaProvider` a local model, `AnthropicProvider` Claude. See [Providers](../../concepts/providers/).

## What you built

A loop: the model reads the question, asks for `get_weather`, the engine runs it, the result goes back, the model answers. `maxIterations` stops a loop that does not end.

Next: [what the engine does each turn](../../concepts/engine-and-tools/), or jump to [making an agent that has to ask before it pays](../../guides/govern-a-payment-tool/).
