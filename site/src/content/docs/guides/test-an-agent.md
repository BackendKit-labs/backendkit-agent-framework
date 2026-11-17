---
title: Test an agent
description: Test the logic of an agent with a scripted model, and its failures with a mock LLM server - no API key, no network.
---

Install the testkit as a **dev dependency**. It needs no API key and no network, and no particular test runner: its assertions throw plain `Error`s, so it works with jest, vitest or `node:test`.

```bash
npm install -D @backendkit-labs/agent-testkit
```

In a scaffolded project, `npx create-bk-agent add testing` does this and adds an example test.

## 1. The logic of your agent: a scripted provider

`scriptedProvider(turns)` is a model that answers from a script: text, or tool calls. The engine believes it is talking to a real one.

```ts
import { createBaseEngine, defineTool, z } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const t = mockTransport();
const engine = createBaseEngine({
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'c1', name: 'get_weather', args: { city: 'London' } }] },
    { content: 'It is sunny in London.' },
  ]) },
  defaultProvider: 'mock', agents: [assistant], defaultAgent: 'assistant',
  tools: [weather], transport: t.transport, workingDir: process.cwd(), iterationMode: 'auto',
});

const result = await engine.run('weather in London?');

expect(result.toolCalls.map(c => c.name)).toEqual(['get_weather']);
expect(result.toolCalls[0].success).toBe(true);
expect(result.text).toContain('sunny');
```

What this proves: given a model that asks for this tool with these arguments, your tool, your profile and your wiring behave. What it does **not** prove: that a real model would ask for it. That is a different question (see below).

`mockTransport()` records every event: `eventsOf('tool_result')`, `text()`, `clear()`. `provider.calls` keeps what each call received, so you can assert on the prompt the model was given.

## 2. Policies and approvals

A scripted model that *always* asks for the dangerous thing is the best test of a [policy](../govern-a-payment-tool/): whatever it asks, check what ran.

## 3. Failures of a real provider: the mock server

`startMockLlmServer` is an HTTP server that speaks the OpenAI streaming protocol and misbehaves on demand. Point the **real** provider at it:

```ts
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';
import { startMockLlmServer } from '@backendkit-labs/agent-testkit';

const server = await startMockLlmServer({ script: [
  { kind: 'status', status: 429 },            // the provider retries this
  { kind: 'text', content: 'fine now' },
] });
const provider = new OpenAICompatibleProvider({ apiKey: 'test', baseUrl: server.url, model: 'mock' });
```

You test your own retry, abort and error handling against the real client code, with no network.

## 4. Record once, replay forever

`RecordingProvider` wraps a real provider and writes every call to JSONL. `ReplayProvider` replays that file with no network, and can inject faults the recording did not contain. It is how you turn one real session into a regression test.

## 5. Assert on the world, not on the words

`world.fileEquals`, `world.untouched` and `world.processGone` check the real system after a run. "The agent said it deleted the file" is a claim; the file is the fact.

## What a test cannot tell you

Offline tests check plumbing: tools, wiring, policy, flows. Whether a *model* behaves well needs a real model. Keep a small, capped live script next to your offline tests and run it when the prompt or the tools change (the [examples](../../examples/overview/) each have one).

Reference: the [`agent-testkit` page](../../packages/testkit/).
