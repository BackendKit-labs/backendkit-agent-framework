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
| `cut` | the stream starts, then the connection dies (a provider must not retry this) |
| `corrupt` | a 200 stream whose first chunk is not JSON |
| `stall` | never answers (to test aborts and timeouts) |
| `overflow` | the exact 400 DeepSeek/OpenAI send when the prompt does not fit the context window |

Instead of a script, `random: { seed, weights }` picks a behaviour per request from a seeded generator: the same seed plays the same sequence.

### 3. Check the world, not the agent's report

```ts
import { world } from '@backendkit-labs/agent-testkit';

const guard = world.untouched([join(dir, '.env')]);   // snapshot now
await engine.run('refactor src/');
guard.verify();                                       // throws if .env changed, appeared or vanished
world.fileEquals(join(dir, 'out.txt'), 'done');
await world.processGone(pid);                         // the background process really stopped
```

## Not here yet

Recording a real run and replaying it (`RecordingProvider` / `ReplayProvider`), an Anthropic-format mock server and a fake clock are planned (SPEC-0007). Jest's own fake timers cover deadlines and TTLs meanwhile.
