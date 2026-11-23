# @backendkit-labs/agent-testkit

Test doubles for agents built on `@backendkit-labs/agent-core`. Install it as a **dev dependency**; it needs no API key and no network.

```bash
npm i -D @backendkit-labs/agent-testkit
```

In a project made with `create-bk-agent`, `npx create-bk-agent add testing` installs it together with jest and drops in an example test.

It does not depend on a test runner: assertions throw plain `Error`s, so it works with jest, vitest or `node:test`.

## What is in it

| Piece | Use |
|---|---|
| `scriptedProvider(turns)` | an `LLMProvider` that answers from a script (text, tool calls, optional token metrics); `provider.calls` keeps what each call received |
| `mockTransport()` | a `Transport` that records events: `events`, `eventsOf('tool_result')`, `text()`, `clear()` |
| `startMockLlmServer({ script })` | an HTTP server that speaks the OpenAI chat-completions streaming protocol and misbehaves on demand |
| `RecordingProvider(inner, sink)` | wraps a real provider and writes every call (request, chunks, tool calls, metrics, errors, timings) as JSONL |
| `ReplayProvider(file, options)` | replays a recording with no network; a sidecar file or `overrides` injects faults the recording does not contain |
| `evalSuite`, `compare`, graders | cases as data, repetitions, a JSON report and the difference of two configurations (see below) |
| `world.fileEquals / untouched / processGone` | assertions about the real system, not about what the agent claims |

## How to test an agent

### 1. Logic of your agent: a scripted provider

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const t = mockTransport();
const engine = createBaseEngine({
    agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
    identity: { userId: 'me' },                // on whose behalf it acts
    providers: { mock: scriptedProvider([
        { tool_calls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }] },
        { content: 'The file says hello.' },
    ]) },
    defaultProvider: 'mock', agents: [myAgent], defaultAgent: myAgent.id,
    tools: [readFileTool], transport: t.transport, workingDir: dir, iterationMode: 'auto',
});

await engine.run('what is in a.txt?');
expect(t.eventsOf('tool_result')[0].success).toBe(true);
expect(t.text()).toContain('hello');
```

### 2. Failures of a real provider: the mock server

Point the real provider at the server and script what goes wrong:

```ts
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';
import { startMockLlmServer } from '@backendkit-labs/agent-testkit';

const server = await startMockLlmServer({ script: [
    { kind: 'status', status: 429 },                 // retried by the provider
    { kind: 'text', content: 'fine now' },
] });
const provider = new OpenAICompatibleProvider({
    apiKey: 'test', baseUrl: server.url, model: 'mock',
    retryBaseDelayMs: 1,                             // keep backoff out of your test time
});
// ... run the agent, then:
expect(server.requests).toHaveLength(2);             // what the client really sent is captured
await server.close();
```

Behaviours (one is consumed per request; when the script is used up the server answers `500 mock script exhausted`):

| `kind` | What happens |
|---|---|
| `text` | a streamed answer (`chunkSize`, `usage`, `delayMs`) |
| `tool_call` | an assistant turn calling `name` with `args` |
| `status` | an HTTP error before streaming (429, 500, 503…) |
| `reset` | the connection is dropped |
| `stream_error` | the stream starts, then an error event arrives inside it (what OpenAI/DeepSeek send when something fails after the 200); a provider must not retry this |
| `cut` | the stream starts, then the connection is reset. Plain `fetch` sees the failure on every platform; the OpenAI SDK's HTTP client was observed to hang on Linux (not abortable), so test mid-stream failures of a provider with `stream_error` and use `cut` only with a client you have checked |
| `corrupt` | a 200 stream whose first chunk is not JSON |
| `stall` | never answers (to test aborts and timeouts) |
| `overflow` | the exact 400 DeepSeek/OpenAI send when the prompt does not fit the context window |

Instead of a script, `random: { seed, weights }` picks a behaviour per request from a seeded generator: the same seed plays the same sequence.

### 3. Record a real run once, replay it forever

```ts
import { RecordingProvider, ReplayProvider } from '@backendkit-labs/agent-testkit';

// once, with the real provider (or the mock server):
const provider = new RecordingProvider(realProvider, 'fixtures/refactor.jsonl');

// in every test run, no network, no key:
const replay = new ReplayProvider('fixtures/refactor.jsonl', { verifyRequests: true });
```

`verifyRequests` fails the replay when your code starts sending something different from what was recorded, so a changed prompt or history shows up as a clear message instead of a silently different answer.

Recordings contain the whole conversation: review them before committing, or pass `redact` to `RecordingProvider`.

**Injecting faults.** Put `fixtures/refactor.override.json` next to the recording (it is picked up automatically), or pass `overrides`. Keys are the 1-based number of the `chat()` invocation:

```json
{ "inject": {
    "2": { "error": { "message": "Too Many Requests", "status": 429 } },
    "4": { "cancel": true },
    "5": { "hang": true }
} }
```

An injected invocation does not use up a recorded call: the next invocation plays the next recorded one, which is what a retry, or the engine's recovery from a context overflow, would see live. `hang` waits until the call's `signal` is aborted.

### 4. Check the world, not the agent's report

```ts
import { world } from '@backendkit-labs/agent-testkit';

const guard = world.untouched([join(dir, '.env')]);   // snapshot now
await engine.run('refactor src/');
guard.verify();                                       // throws if .env changed, appeared or vanished
world.fileEquals(join(dir, 'out.txt'), 'done');
await world.processGone(pid);                         // the background process really stopped
```

### 5. Evaluate an agent: cases, repetitions, a comparison

When "the agent works" has to be a number, write the checks as **data** and run them as a suite. Nothing here calls a model: `build` returns the engine of each run, so a scripted or replayed provider makes the suite free and repeatable.

```ts
import { evalSuite, compare, formatReport, toolCalled, toolNotCalled, noToolErrors, textMatches } from '@backendkit-labs/agent-testkit';
import { selfAssertedIdentities } from '@backendkit-labs/agent-core';

const cases = [
  { id: 'places an order', input: 'buy 10 AAPL', expect: [toolCalled('place_order', { with: a => (a.sizePct as number) <= 15 }), noToolErrors()] },
  { id: 'no trade on a question', input: 'what is a stock?', expect: [toolNotCalled('place_order')] },
];

const report = await evalSuite({
  name: 'prompt v2', cases, repeat: 5, seed: 1,
  build: (c, run) => createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, /* your agent */ recordArgs: true /* only if a grader reads arguments */ }),
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

## Not here yet

An Anthropic-format mock server and a fake clock are planned (SPEC-0007). Jest's own fake timers cover deadlines and TTLs meanwhile.
