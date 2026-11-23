# @backendkit-labs/agent-web

HTTP/WebSocket server layer for [@backendkit-labs/agent-core](https://www.npmjs.com/package/@backendkit-labs/agent-core).

Wraps `AgentEngine` in a Fastify 5 server with streaming WebSocket sessions, JWT authentication, Prometheus metrics, rate limiting, a real-time monitor bus, and a flexible trigger system (cron jobs, webhooks, BullMQ queues).

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-web)](https://www.npmjs.com/package/@backendkit-labs/agent-web)

---

## Installation

```bash
npm install @backendkit-labs/agent-web @backendkit-labs/agent-core
```

Optional integrations (install only what you need):

```bash
npm install jsonwebtoken          # JWT auth
npm install prom-client           # Prometheus metrics
npm install @fastify/rate-limit   # rate limiting
npm install node-cron             # cron triggers
npm install bullmq                # queue triggers
npm install ioredis               # Redis session store
```

---

## Quick start

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';
import type { EngineFactory } from '@backendkit-labs/agent-web';
import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engineFactory: EngineFactory = (sessionId, transport, caller) =>
  new AgentEngine({
    transport,
    sessionId,
    agentIdentity: selfAssertedIdentities(),                    // who the agent is
    identity: { userId: caller?.userId ?? 'anonymous' },        // for whom: the person the server authenticated
    // ...your engine config
  });

const server = new AgentServer({
  port:          3000,
  engineFactory,
  cors:          '*',
});

await server.start();
// WS  /chat      — streaming chat sessions
// WS  /monitor   — real-time read-only observer
// GET /health    — { status, sessions, monitors }
// GET /sessions  — active session list
// DELETE /sessions/:id — close a session
```

---

## What else is in it

Everything below is in the **[reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md)**: each topic has its own section with examples.

| Topic | What it covers |
|---|---|
| [AgentServer options](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#agentserver-options) | // Network port?: number; // default: 3000 host?: string; // default: '127.0.0.1' (use '0.0.0.0', with auth, for remote callers) cors?: string /... |
| [HTTP and WebSocket routes](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#http-and-websocket-routes) | --- |
| [WebSocket protocol](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#websocket-protocol) | Client → server |
| [EngineFactory pattern](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#enginefactory-pattern) | `EngineFactory` is a function `(sessionId |
| [SessionManager](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#sessionmanager) | `SessionManager` creates, tracks and cleans up sessions. |
| [JWT authentication](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#jwt-authentication) | `JwtAuth` validates Bearer tokens on HTTP routes and on the WebSocket handshake. |
| [Prometheus metrics](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#prometheus-metrics) | Requires `prom-client` to be installed. |
| [Rate limiting](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#rate-limiting) | Requires `@fastify/rate-limit`. |
| [Session metadata store](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#session-metadata-store) | By default, session metadata lives in memory and is lost on restart. |
| [MonitorBus](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#monitorbus) | `MonitorBus` broadcasts all session events to connected `/monitor` WebSocket observers. |
| [TriggerBus — cron, webhooks, queues](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#triggerbus--cron-webhooks-queues) | `TriggerBus` runs agents without a WebSocket client |
| [HeadlessTransport](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#headlesstransport) | A `Transport` with no socket |
| [Full production example](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/web/REFERENCE.md#full-production-example) | JWT auth, Redis sessions, Prometheus metrics, a cron job, a webhook and a queue |
