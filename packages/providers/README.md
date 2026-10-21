# @backendkit-labs/agent-providers

LLM providers for [`@backendkit-labs/agent-core`](../core): one retry/streaming implementation shared by
every agent package.

| Export | What |
|---|---|
| `OpenAICompatibleProvider` | Any OpenAI-compatible API (OpenAI, Kimi, Grok…) |
| `DeepSeekProvider` | Preset: DeepSeek base URL and default model |
| `OllamaProvider` | Preset: local Ollama, short backoff, helpful connection errors, `checkConnection()` |
| `AnthropicProvider` | Anthropic Messages API |
| `BaseStreamingProvider` | Base class: retries, abort handling, tool-call assembly |

```ts
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY!, maxAttempts: 3 });
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
