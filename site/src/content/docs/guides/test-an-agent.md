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

## 6. Evaluate an agent: cases, repetitions, a comparison

When "the agent works" has to be a number, write the checks as **data** and run them as a suite. Nothing here calls a model: `build` returns the engine of each run, so a scripted or replayed provider makes the suite free and repeatable.

```ts
import { evalSuite, compare, formatReport, toolCalled, toolNotCalled, noToolErrors, textMatches } from '@backendkit-labs/agent-testkit';

const cases = [
  { id: 'places an order', input: 'buy 10 AAPL', expect: [toolCalled('place_order', { with: a => (a.sizePct as number) <= 15 }), noToolErrors()] },
  { id: 'no trade on a question', input: 'what is a stock?', expect: [toolNotCalled('place_order')] },
];

const report = await evalSuite({
  name: 'prompt v2', cases, repeat: 5, seed: 1,
  build: (c, run) => createBaseEngine({ /* your agent */ recordArgs: true /* only if a grader reads arguments */ }),
});
console.log(formatReport(report));                 // for a person; the report itself is JSON
const diff = compare(reportV1, report);            // per case and in total, with the number of runs each rate rests on
```

- **Graders** read the `RunResult`: `toolCalled` (optionally `times` and a check on the arguments), `toolNotCalled`, `noToolErrors`, `errorCode`, `textMatches`, `withinBudget`, `maxToolCalls`, or your own with `grader(name, fn)`. A judge model is a grader you write; the framework brings none.
- **Arguments** are in the result only with `recordArgs: true` in the engine. They go to the `RunResult` and nowhere else (the `tool_result` event does not carry them): they can be sensitive, and the audit log keeps only their hash. A grader that reads them fails, saying so, when they are missing.
- **Repetitions.** A real model is not deterministic, so one run is not evidence. The report gives a pass rate per case and for the suite. `build` receives `seed` (`seed + repetition - 1`) to seed your simulated world.
- **The report is repeatable.** The same suite over the same scripted provider gives the same JSON, byte for byte: timing is left out unless you ask for it (`includeTiming`).
- **It does not hide a stop.** When a run reports `budgetExceeded`, the suite stops and the report says `stoppedEarly: 'budget'`. A run that throws is a failed run with its message.
- **Save it to compare later.** `writeReport(report, file)` writes the JSON (mode `0o600`, creating the folder) and `readReport(file)` reads it back, so a new run can `compare` against a baseline from another day. Nothing is saved unless you call it.
- **Treat the report as sensitive data.** It keeps the `RunResult` of each run, with `preview` text and, with `recordArgs`, arguments.
- **In CI, without a model:** build the engine over a scripted provider, or over a `ReplayProvider` of a recorded session. A tool that stops being called, or an error code that appears, breaks the suite.

## What a test cannot tell you

Offline tests check plumbing: tools, wiring, policy, flows. Whether a *model* behaves well needs a real model. Keep a small, capped live script next to your offline tests and run it when the prompt or the tools change (the [examples](../../examples/overview/) each have one).

Reference: the [`agent-testkit` page](../../packages/testkit/).
