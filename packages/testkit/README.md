# @backendkit-labs/agent-testkit

Test doubles for agents built on `@backendkit-labs/agent-core`. Install it as a **dev dependency**; it needs no API key and no network.

```bash
npm i -D @backendkit-labs/agent-testkit
```

It does not depend on a test runner: assertions throw plain `Error`s, so it works with jest, vitest or `node:test`.

## What is in it

| Piece | Use |
|---|---|
| `scriptedProvider(turns)` | an `LLMProvider` that answers from a script (text, tool calls, optional token metrics); `provider.calls` keeps what each call received |
| `mockTransport()` | a `Transport` that records events: `events`, `eventsOf('tool_result')`, `text()`, `clear()` |
| `startMockLlmServer({ script })` | an HTTP server that speaks the OpenAI chat-completions streaming protocol and misbehaves on demand |
| `RecordingProvider(inner, sink)` | wraps a real provider and writes every call (request, chunks, tool calls, metrics, errors, timings) as JSONL |
| `ReplayProvider(file, options)` | replays a recording with no network; a sidecar file or `overrides` injects faults the recording does not contain |
| `world.fileEquals / untouched / processGone` | assertions about the real system, not about what the agent claims |

## How to test an agent

### 1. Logic of your agent: a scripted provider

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const t = mockTransport();
const engine = createBaseEngine({
    providers: { mock: scriptedProvider([
        { tool_calls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }] },
        { content: 'The file says hello.' },
    ]) },
    defaultProvider: 'mock', agents: [myAgent], defaultAgent: myAgent.id,
    tools: [readFileTool], transport: t.transport, workingDir: dir, noQA: true, iterationMode: 'auto',
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

## Not here yet

An Anthropic-format mock server and a fake clock are planned (SPEC-0007). Jest's own fake timers cover deadlines and TTLs meanwhile.
