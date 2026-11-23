# @backendkit-labs/agent-providers

LLM providers for [`@backendkit-labs/agent-core`](../core): one retry/streaming implementation shared by
every agent package.

| Export | What |
|---|---|
| `OpenAICompatibleProvider` | Any OpenAI-compatible API (OpenAI, Kimi, Grok…) |
| `DeepSeekProvider` | Preset: DeepSeek base URL and default model |
| `OllamaProvider` | Preset: local Ollama, short backoff, helpful connection errors, `checkConnection()` |
| `AnthropicProvider` | Anthropic Messages API |
| `fromAiSdk(model)` | Any model of the [Vercel AI SDK](https://ai-sdk.dev) (Google, Bedrock, Azure, Mistral, Groq…), no dependency on the SDK |
| `BaseStreamingProvider` | Base class: retries, abort handling, tool-call assembly |

```ts
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY!, maxAttempts: 3 });
```

### A model of the Vercel AI SDK

```ts
import { google } from '@ai-sdk/google';
import { fromAiSdk } from '@backendkit-labs/agent-providers';

const provider = fromAiSdk(google('gemini-2.5-pro'));   // or openai(...), bedrock(...), any model of the SDK
```

This package does not depend on the SDK: it takes the model by shape and understands interface versions 2, 3 and 4 of the SDK ([SPEC-0029](../../docs/specs/SPEC-0029-adaptador-de-providers-del-ai-sdk.md)). The SDK only talks to the model; **the engine runs the tools** (they go out without `execute`), so policy and approval still apply. Retries are ours (the SDK model does not retry). `capabilities.structuredOutput` is `none` unless you declare it with `structuredOutput`. Other options: `temperature`, `maxOutputTokens`, `providerOptions`.

## A complete example: an agent over a real provider, and what happens when the API fails

One file. It runs a support agent over `OpenAICompatibleProvider` against a **local mock server** (from `agent-testkit`) that speaks the OpenAI streaming protocol and fails on demand, so you see the real retry and error behaviour with no key and no network. To use a real API, change only `baseUrl`, `apiKey` and `model`. Save it as `provider.ts` and run it with `npx tsx provider.ts`.

```bash
npm install @backendkit-labs/agent-core @backendkit-labs/agent-providers
npm install -D @backendkit-labs/agent-testkit typescript tsx
```

```ts
import { createBaseEngine, defineTool, z, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';
import { startMockLlmServer, mockTransport, type MockBehavior } from '@backendkit-labs/agent-testkit';

const orderStatus = defineTool({
  name: 'order_status', description: 'Status of an order', readOnly: true,
  input: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => `Order ${orderId}: shipped`,
});
const support = { id: 'support', name: 'Support', icon: '🎧', description: 'Answers about orders', systemPrompt: 'You help customers.', allowedTools: ['order_status'] };

// Plays one conversation against a server that behaves as `script` says (one behaviour per request).
async function run(label: string, script: MockBehavior[]) {
  const server = await startMockLlmServer({ script });
  const provider = new OpenAICompatibleProvider({
    apiKey: 'test',
    baseUrl: server.url,           // a real API: 'https://api.openai.com/v1'
    model: 'mock',
    maxAttempts: 3,                // total attempts, the first included
    retryBaseDelayMs: 1,           // keep the backoff short in a demo; leave the default in production
  });
  const transport = mockTransport();
  const engine = createBaseEngine({
    agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
    identity: { userId: 'me' },                // on whose behalf it acts
    providers: { main: provider }, defaultProvider: 'main',
    agents: [support], defaultAgent: 'support', tools: [orderStatus],
    transport: transport.transport, workingDir: process.cwd(), iterationMode: 'auto',
  });

  const result = await engine.run('Where is order A-1001?');
  console.log(`${label}: ${server.requests.length} request(s) | text: ${JSON.stringify(result.text)} | errors: ${JSON.stringify(result.errors)}`);
  await server.close();
}

// 1. A 429 first: the provider waits and retries on its own. The run never notices.
await run('rate limited, then fine', [
  { kind: 'status', status: 429 },
  { kind: 'tool_call', name: 'order_status', args: { orderId: 'A-1001' } },
  { kind: 'text', content: 'Your order A-1001 has shipped.', usage: { promptTokens: 120, completionTokens: 9 } },
]);

// 2. The stream starts and then fails. Part of the answer already reached the user: NOT retried.
await run('fails inside the stream', [{ kind: 'stream_error', message: 'upstream failed', content: 'Your ord', afterChunks: 1 }]);

// 3. Every attempt fails: it gives up after maxAttempts and reports the last error.
await run('every attempt fails', [503, 503, 503].map(status => ({ kind: 'status' as const, status })));

// 4. The prompt does not fit the model: a 400 is not retried, because the same request would fail again.
await run('context overflow', [{ kind: 'overflow' }]);
```

What it prints (the long overflow message is cut):

```text
rate limited, then fine: 3 request(s) | text: "Your order A-1001 has shipped." | errors: []
fails inside the stream: 1 request(s) | text: "Your o" | errors: ["upstream failed"]
every attempt fails: 3 request(s) | text: "" | errors: ["503 mock error 503"]
context overflow: 1 request(s) | text: "" | errors: ["400 This model's maximum context length is ..."]
```

What each case teaches:

| Case | Requests | What the provider did | What you do |
|---|---|---|---|
| 1. 429 | 3 (429, tool call, answer) | Retried the 429 with backoff. A retried request is invisible to the run. | Nothing. Raise `maxAttempts` if your API is often busy. |
| 2. Failure inside the stream | 1 | Did **not** retry: the user already saw `Your o`, and a retry would repeat or contradict it. The partial text stays in `result.text` and the failure in `result.errors`. | Decide in your app: show the partial answer with a warning, or discard it. |
| 3. Every attempt fails | 3 | Retried the 5xx twice, then reported the last error. `chat()` itself never throws: failures arrive as `errors`. | Show an error, or fall back to another provider you registered. |
| 4. Overflow | 1 | A 400 is not retried. Inside an engine with a context budget, an overflow also triggers a forced compaction before the run gives up (see context compaction in `agent-core`). | Shrink the input, or turn on the engine's context budget. |

A run that ended in an error is still a **returned result**, not an exception: look at `result.errors` (and `result.aborted`, `result.budgetExceeded`) before trusting `result.text`.

## Several providers in one engine

`providers` is a map, so one engine can hold several models and send each agent to the one that suits it:

```ts
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  providers: {
    fast: new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }),
    local: new OllamaProvider({ model: 'llama3.1' }),          // for the agents that must not leave the machine
  },
  defaultProvider: 'fast',
  agents: [
    { ...support, provider: 'fast' },
    { ...hrAssistant, provider: 'local' },                      // `provider` on the profile picks it
  ],
  // ...
});
```

## Behaviour

- Retries 429, 5xx and network errors with exponential backoff (`@backendkit-labs/retry`).
  `maxAttempts` counts total attempts, first try included. `maxRetries` is a deprecated alias.
- Never retries once content reached the caller, nor after the call was aborted.
- Failures are reported through `callbacks.onError`; `chat()` does not throw.
- Always requests token usage and reports it through `callbacks.onMetrics`.
- `callbacks.model` and `callbacks.signal` are honoured.
- `maxTokens: null` leaves `max_tokens` out of the request; `temperature` can be a function of the model.
- Inject `client` to use your own SDK instance, or a test double.

`@backendkit-labs/agent-core` is a peer dependency (types only).
