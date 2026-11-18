---
title: Observability and cost
description: Budgets that stop a run, cost and metrics, traces to OpenTelemetry, and an audit record per call.
---

An agent in production needs four answers: *what did it do, what did it cost, how is it behaving, and can I stop it.*

## Cost and a hard stop

The cost tracker prices each model call from its token usage. With a **budget** the engine stops the run when it is crossed.

```ts
createBaseEngine({
  /* ... */
  observability: {
    costTracker: {
      inputPricePerMToken: 0.30,          // dollars per million tokens: use your model's price list
      outputPricePerMToken: 1.20,
      budget: { perRun: 0.10 },           // stop one run at 10 cents
    },
  },
  abortOnBudget: true,
});
```

When it trips, `result.budgetExceeded` is `true` and the turn is aborted. `ObservabilityManager` ties cost tracking, metrics and tracing together; `MODEL_PRICING` has reference prices for common models.

## Metrics

`MetricsCollector` keeps a snapshot: active sessions, runs total, succeeded and failed, average duration. `agent-web` exposes them to Prometheus.

## Traces: OpenTelemetry

`@backendkit-labs/agent-otel` exports the engine's traces. Choose by how you run telemetry:

| You have | Use |
|---|---|
| A collector or backend that speaks OTLP/HTTP (Jaeger, Tempo, Langfuse, Datadog, the OpenTelemetry Collector) and no OpenTelemetry SDK | `otlpHttpSpanExporter` |
| An OpenTelemetry SDK already registered in the process | `otelApiSpanExporter` |

```ts
import { otlpHttpSpanExporter } from '@backendkit-labs/agent-otel';

const exporter = otlpHttpSpanExporter({ endpoint: 'http://localhost:4318', serviceName: 'support-agent' });
```

## Audit: one record per call

An `AuditSink` receives **exactly one event per tool call**, whether it ran or was refused, with the arguments as a SHA-256 only. `HashChainAuditSink` chains the records so a removed or edited line is detectable. See [governance](../governance/).

## One id per run

Every `engine.run()` has a `runId`. The result carries it (`result.runId`), every audit event of the run carries the same one (`AuditEvent.runId`), and every span of the run has it as the `run_id` tag. So you can go from an audit event to its run and its trace, and back: find the event, read its `runId`, filter the spans by `run_id`.

```ts
const r = await engine.run('close the month');
r.runId;                       // the same id is in each audit event and in the tag run_id of each span
await engine.run('close the month', { runId: flowRunId });   // or use your own, for example the id of the flow run this turn belongs to
```

A delegate belongs to the run of the agent that asked: one id for the whole turn. A tool called outside a run has no `runId`. The id is optional in the audit event, and the hash chain covers it like any other field.

## Cancellation and time limits

A tool call can have a time limit (`toolTimeoutMs`, or per tool). On expiry the call's `ctx.signal` is aborted and the model is told the call timed out; a late result is discarded. Pass the signal to anything cancellable so stopping a turn stops the work.

## Seeing it live

`agent-web` has a `/monitor` WebSocket, a real-time read-only observer, and `agent-web-ui` ships a Kanban monitor on top of it.
