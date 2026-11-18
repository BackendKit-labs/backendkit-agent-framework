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
