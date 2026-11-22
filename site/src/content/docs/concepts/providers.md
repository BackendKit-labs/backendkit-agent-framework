---
title: Providers
description: How the engine talks to a model, which providers ship, and how retries and failures behave.
---

A **provider** is the object that talks to a model. The engine only knows a small interface (`LLMProvider`: a `chat` method that streams), so any model fits. `agent-providers` ships the common ones:

| Export | What |
|---|---|
| `OpenAICompatibleProvider` | Any OpenAI-compatible API (OpenAI, Kimi, Grok...). |
| `DeepSeekProvider` | A preset with DeepSeek's base URL and default model. |
| `OllamaProvider` | A preset for a local Ollama: short backoff, clear connection errors, `checkConnection()`. |
| `AnthropicProvider` | The Anthropic Messages API. |

```ts
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY!, maxAttempts: 3 });
```

The engine takes providers by name, and each agent can choose one (and a model):

```ts
createBaseEngine({
  providers: { fast: cheapProvider, smart: strongProvider },
  defaultProvider: 'fast',
  agents: [
    { /* ... */ id: 'triage' },                                  // uses 'fast'
    { /* ... */ id: 'analyst', provider: 'smart' },              // uses 'smart'
  ],
  /* ... */
});
```

An agent can also override only the `model` while keeping the provider: a light agent on a cheap model, a reasoning agent on a stronger one.

## Behaviour you can rely on

- **Retries** on 429, 5xx and network errors, with exponential backoff. `maxAttempts` counts total attempts, the first included.
- **No retry once content reached you**, and none after the call was aborted. A half-delivered answer is never replayed.
- **A stream that goes quiet is cut.** If a model stops sending without closing the connection, the provider cuts it after `streamIdleTimeoutMs` (120 seconds by default, `0` turns it off). Before any output reached you it is retried like a network failure; after, it is reported as an error. Without this, a stalled connection holds the turn until someone aborts it.
- **A cut answer says so.** When the model stops because it hit the output limit (`max_tokens`), the text ends with a note saying it was cut, so nobody takes it for complete. A **tool call** cut in the middle is an error, never a call with half its arguments. If you see the note often, raise `maxTokens`.
- **Failures arrive as events** (`callbacks.onError`); `chat()` does not throw.
- **Token usage** is always requested and reported, which is what powers cost tracking and budgets.

```ts
const provider = new OpenAICompatibleProvider({
  apiKey: process.env.API_KEY!,
  baseUrl: 'https://api.example.com/v1',   // omit for api.openai.com
  model: 'my-model',
  maxTokens: 8192,                          // default 16384
  maxAttempts: 3,                           // total attempts, the first included
  streamIdleTimeoutMs: 60_000,              // cut a stream that sends nothing for a minute
});
```

## Your own provider

A provider is one method, `chat`. It streams text with `onChunk`, reports usage with `onMetrics` (cost tracking reads it) and ends with exactly one `onDone` or one `onError`. This one repeats what you say; it runs as it is:

```ts
import { createBaseEngine, type AgentProfile, type LLMProvider } from '@backendkit-labs/agent-core';
import { mockTransport } from '@backendkit-labs/agent-testkit';

const echo: LLMProvider = {
  async chat(messages, _tools, callbacks) {
    const last = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const answer = `You said: ${last}`;
    callbacks.onChunk?.(answer);                                  // stream the text as it is produced
    callbacks.onMetrics?.(12, 6);                                 // token usage: input, output
    callbacks.onDone({ role: 'assistant', content: answer });     // exactly one onDone, or one onError
  },
};

const agent: AgentProfile = { id: 'echo', name: 'Echo', icon: '🔁', description: 'Repeats', systemPrompt: 'Repeat.', allowedTools: [] };
const engine = createBaseEngine({
  providers: { echo }, defaultProvider: 'echo', agents: [agent], defaultAgent: 'echo', tools: [],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
});

console.log((await engine.run('hello')).text);                    // You said: hello
```

A real provider also passes `callbacks.signal` to its HTTP request, so `engine.abort()` stops the call, and turns the model's tool requests into `callbacks.onToolCall(name, args, id)` before `onDone`. For tests you rarely need your own: use the [scripted provider](../../guides/test-an-agent/) instead of a real one.

Reference: the [`agent-providers` page](../../packages/providers/).
