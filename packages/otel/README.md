# @backendkit-labs/agent-otel

OpenTelemetry export for the traces of [`@backendkit-labs/agent-core`](../core). Pick the exporter that fits
how you run telemetry:

| You have | Use |
|---|---|
| A collector or backend that speaks OTLP/HTTP (Jaeger, Tempo, Langfuse, Datadog, the OpenTelemetry Collector…) and **no** OpenTelemetry SDK | `otlpHttpSpanExporter` |
| An OpenTelemetry SDK already registered in the process (auto-instrumentation, your own processors/exporters) | `otelApiSpanExporter` |

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';
import { otlpHttpSpanExporter } from '@backendkit-labs/agent-otel';

const exporter = otlpHttpSpanExporter({ endpoint: 'http://localhost:4318', serviceName: 'support-agent' });

const engine = createBaseEngine({
  // ...
  observability: { tracing: { exporter } },
});

// on shutdown
await exporter.shutdown();
```

```ts
import { otelApiSpanExporter } from '@backendkit-labs/agent-otel';   // needs @opentelemetry/api
observability: { tracing: { exporter: otelApiSpanExporter() } }
```

## What you get

One trace per `engine.run()`:

```
agent.run
└─ invoke_agent Main
   ├─ chat deepseek-chat          (tokens, model, provider, cost, cache tokens)
   ├─ execute_tool read_file      (success, duration — parallel tools overlap in time)
   └─ chat deepseek-chat
```

Attributes follow the OpenTelemetry **GenAI semantic conventions**: `gen_ai.operation.name`
(`invoke_agent` / `chat` / `execute_tool`), `gen_ai.request.model`, `gen_ai.provider.name`,
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`,
`gen_ai.usage.cache_creation.input_tokens`, `gen_ai.agent.id/name`, `gen_ai.tool.name`. Anything specific to
agent-core (cost in USD, the original trace id, guardrail actions, why an extra LLM call was made) lives under
`bk.*`, e.g. `bk.cost_usd`, `bk.llm.purpose` (`context_summary`, `structured_output`), `bk.guardrail.<name>.<action>`.

**Conversation content is never exported.** Spans carry names, durations, token counts and ids only: no
prompts, answers, tool arguments or tool results.

Requires `@backendkit-labs/agent-core` with `llm_call` / `tool_call` spans (0.28+). With 0.27 you only get
`agent.run` and `invoke_agent`.

## `otlpHttpSpanExporter(options)`

Sends OTLP/JSON to `<endpoint>/v1/traces`. No SDK, no dependencies.

| Option | Default | |
|---|---|---|
| `endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` or `http://localhost:4318` | `/v1/traces` is appended unless already there |
| `headers` | – | e.g. `{ Authorization: 'Basic …' }` |
| `serviceName` | `agent` | `service.name` resource attribute |
| `resourceAttributes` | – | `deployment.environment`, `service.version`… |
| `batchSize` | 64 | spans buffered before sending |
| `flushIntervalMs` | 2000 | a partial batch is sent after this long (timer is `unref`'d) |
| `timeoutMs` | 10000 | per request |
| `onError` | – | a failed send is reported here and **that batch is dropped**; it never reaches the agent |
| `fetch` | global `fetch` | for tests or custom transports |

Returns a function with `flush()` and `shutdown()`. Sends are serialized, never overlapping.
Ids are derived deterministically from agent-core's ids, so parent/child links are preserved.

## `otelApiSpanExporter(options)`

Re-creates the spans through `@opentelemetry/api` (`options.tracer`, default
`trace.getTracer('@backendkit-labs/agent-core')`), so they reach whatever your SDK exports to.

The OpenTelemetry API cannot choose a span's id, and a child must be created from its parent's real span.
agent-core exports spans as they end (children first), so this adapter holds a trace's spans until the root
`agent.run` ends and then creates the tree parents-first with the original start/end times. Consequences:

- Spans of a run appear in your backend when the run finishes, not while it runs.
- A run that never ends (crash) leaves its spans buffered: call `exporter.flush()` on shutdown (spans whose
  parent never arrived become roots). `maxBufferedSpans` (default 5000) bounds memory.
- `@opentelemetry/api` is an optional peer dependency; without it the exporter throws a clear error at creation.

## Verified

Unit tests plus a run of a real engine through both exporters. The API adapter was also checked against a real
`@opentelemetry/sdk-trace-base` provider: one trace, correct hierarchy, parallel tool spans overlapping in time.
