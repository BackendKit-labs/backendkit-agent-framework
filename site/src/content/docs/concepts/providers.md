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
- **Failures arrive as events** (`callbacks.onError`); `chat()` does not throw.
- **Token usage** is always requested and reported, which is what powers cost tracking and budgets.

## Your own provider

Implement `LLMProvider` and register it like any other. For tests you rarely need to: use the [scripted provider](../../guides/test-an-agent/) instead of a real one.

Reference: the [`agent-providers` page](../../packages/providers/).
