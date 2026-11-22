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

## A complete example: see a run as a trace

One file. It starts a **tiny OTLP collector** inside the program, runs an agent with one tool, sends its trace through `otlpHttpSpanExporter` and draws what the collector received. No Jaeger, no key, no network: to use a real backend, point `endpoint` at it and drop the collector. Save it as `trace.ts` and run it with `npx tsx trace.ts`.

```bash
npm install @backendkit-labs/agent-core @backendkit-labs/agent-otel
npm install -D @backendkit-labs/agent-testkit typescript tsx
```

```ts
import { createServer } from 'node:http';
import { createBaseEngine, defineTool, z } from '@backendkit-labs/agent-core';
import { otlpHttpSpanExporter } from '@backendkit-labs/agent-otel';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

// 1. A tiny OTLP collector: receives what the exporter sends and keeps the spans. In production this is Jaeger, Tempo, Langfuse...
const received: any[] = [];
const collector = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    for (const rs of JSON.parse(body).resourceSpans) for (const ss of rs.scopeSpans) received.push(...ss.spans);
    res.setHeader('content-type', 'application/json').end('{}');
  });
});
await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
const port = (collector.address() as { port: number }).port;

// 2. The exporter: ships spans to the collector.
const exporter = otlpHttpSpanExporter({
  endpoint: `http://127.0.0.1:${port}`,
  serviceName: 'support-agent',
  resourceAttributes: { 'deployment.environment': 'demo' },
  onError: err => console.error('export failed:', err),     // a failed send never reaches the agent
});

// 3. An agent with one tool and a cost tracker, traced.
const orderStatus = defineTool({
  name: 'order_status', description: 'Status of an order', readOnly: true,
  input: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => `Order ${orderId}: shipped`,
});
const engine = createBaseEngine({
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'c1', name: 'order_status', args: { orderId: 'A-1001' } }], metrics: { inputTokens: 300, outputTokens: 20 } },
    { content: 'Your order has shipped.', metrics: { inputTokens: 340, outputTokens: 12 } },
  ]) },
  defaultProvider: 'mock',
  agents: [{ id: 'support', name: 'Support', icon: '🎧', description: 'Answers about orders', systemPrompt: 'You help customers.', allowedTools: ['order_status'] }],
  defaultAgent: 'support', tools: [orderStatus],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
  observability: {
    tracing: { exporter },
    costTracker: { inputPricePerMToken: 0.3, outputPricePerMToken: 1.2 },
  },
});

await engine.run('Where is order A-1001?');
await exporter.shutdown();                                   // flushes the batch that is still waiting

// 4. What arrived: one trace, drawn as a tree.
const byId = new Map(received.map(s => [s.spanId, s]));
const attr = (s: any, key: string) => {
  const a = s.attributes?.find((x: any) => x.key === key)?.value;
  return a?.stringValue ?? a?.intValue ?? a?.doubleValue ?? a?.boolValue;
};
const depth = (s: any): number => (s.parentSpanId && byId.has(s.parentSpanId) ? 1 + depth(byId.get(s.parentSpanId)) : 0);
console.log(`traces: ${new Set(received.map(s => s.traceId)).size}, spans: ${received.length}`);
for (const s of [...received].sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)))) {
  const extra = [
    attr(s, 'gen_ai.usage.input_tokens') !== undefined && `in=${attr(s, 'gen_ai.usage.input_tokens')}`,
    attr(s, 'gen_ai.usage.output_tokens') !== undefined && `out=${attr(s, 'gen_ai.usage.output_tokens')}`,
    attr(s, 'bk.cost_usd') !== undefined && `cost=$${Number(attr(s, 'bk.cost_usd')).toFixed(6)}`,
  ].filter(Boolean).join(' ');
  console.log(`${'  '.repeat(depth(s))}${s.name} ${extra}`);
}
collector.close();
```

It prints:

```text
traces: 1, spans: 5
agent.run
  invoke_agent Support
    chat unknown in=300 out=20 cost=$0.000114
    execute_tool order_status
    chat unknown in=340 out=12 cost=$0.000116
```

How to read it:

- **One run, one trace, five spans**, nested as the run happened: the run, the agent, the model call that asked for the tool, the tool, and the model call that answered. The two `chat` spans carry the tokens and the cost (`bk.cost_usd`), so you can see which step spent what. `unknown` is the model name: the scripted provider has none; with a real provider it reads `chat deepseek-chat`.
- **Nothing the user said is in it.** The spans hold names, times, token counts and ids. The prompt, the answer and the tool arguments never leave the process.
- **The exporter batches.** It sends when `batchSize` spans are waiting or after `flushIntervalMs`. `await exporter.shutdown()` flushes the last batch: without it, a short program can end before its spans are sent.
- **Exporting never breaks the agent.** If the collector is down, `onError` gets the error, that batch is dropped, and the run goes on.

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
