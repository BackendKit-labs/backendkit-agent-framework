# @backendkit-labs/agent-web

HTTP/WebSocket server layer for [@backendkit-labs/agent-core](https://www.npmjs.com/package/@backendkit-labs/agent-core).

Wraps `AgentEngine` in a Fastify 5 server with streaming WebSocket sessions, JWT authentication, Prometheus metrics, rate limiting, a real-time monitor bus, and a flexible trigger system (cron jobs, webhooks, BullMQ queues).

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-web)](https://www.npmjs.com/package/@backendkit-labs/agent-web)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [AgentServer options](#agentserver-options)
- [HTTP and WebSocket routes](#http-and-websocket-routes)
- [WebSocket protocol](#websocket-protocol)
- [EngineFactory pattern](#enginefactory-pattern)
- [SessionManager](#sessionmanager)
- [JWT authentication](#jwt-authentication)
- [Prometheus metrics](#prometheus-metrics)
- [Rate limiting](#rate-limiting)
- [Session metadata store](#session-metadata-store)
- [MonitorBus](#monitorbus)
- [TriggerBus — cron, webhooks, queues](#triggerbus--cron-webhooks-queues)
- [HeadlessTransport](#headlesstransport)
- [Full production example](#full-production-example)

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

## AgentServer options

```typescript
interface AgentServerOptions {
  // Required
  engineFactory: EngineFactory;       // creates a new AgentEngine per session

  // Network
  port?:   number;                    // default: 3000
  host?:   string;                    // default: '127.0.0.1' (use '0.0.0.0', with auth, for remote callers)
  cors?:   string | string[];         // default: '*' (none with strict)
  strict?: boolean;                   // fail-closed defaults, see "Strict mode"
  logger?: boolean | object;          // Fastify logger, default: false

  // Auth
  auth?: AuthHook;                    // called on every request before handlers

  // Rate limiting (requires @fastify/rate-limit)
  rateLimiting?: {
    max?:        number;              // max requests per IP per window, default: 100
    timeWindow?: string;             // e.g. '1 minute', '30 seconds'
  };

  // Prometheus metrics (requires prom-client)
  metrics?: {
    enabled:          boolean;        // must be true to activate
    path?:            string;         // default: '/metrics'
    prefix?:          string;         // metric name prefix
    collectNodeMetrics?: boolean;     // include Node.js process metrics
  };

  // Session management
  maxIdleMs?:   number;               // idle timeout before session is closed
  maxSessions?: number;               // max concurrent sessions
  store?:       SessionMetaStore;     // durable metadata store (default: in-memory)

  // Triggers
  triggers?: TriggerBus;             // wires webhook routes and starts cron jobs
}
```

---

## HTTP and WebSocket routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health: `{ status, sessions, monitors, uptime }` |
| `GET` | `/sessions` | Array of active session metadata |
| `DELETE` | `/sessions/:id` | Force-close a session |
| `GET` | `/metrics` | Prometheus metrics (if enabled) |
| `WS` | `/chat` | Streaming chat — one session per connection |
| `WS` | `/monitor` | Read-only observer of all sessions |
| `POST` | `/webhooks/:name` | Webhook trigger (registered via TriggerBus) |

---

## WebSocket protocol

### `/chat` — chat sessions

**Client → server:**

```json
{ "type": "input",  "content": "Your message here" }
{ "type": "abort" }
```

**Server → client** (streamed `AgentEvent` frames):

```json
{ "type": "run_start",     "sessionId": "abc-123" }
{ "type": "token",         "content": "Hello" }
{ "type": "tool_call",     "name": "search", "args": { "query": "..." } }
{ "type": "tool_result",   "name": "search", "result": "..." }
{ "type": "agent_switch",  "from": "general", "to": "security-reviewer" }
{ "type": "done",          "final": "Full assistant response" }
{ "type": "error",         "message": "Something went wrong" }
```

### `/monitor` — real-time observer

Connect to observe all sessions without sending any messages:

```json
{ "type": "monitor_hello",         "sessionIds": ["abc-123", "def-456"] }
{ "type": "monitor_session_open",  "sessionId": "ghi-789" }
{ "type": "monitor_session_close", "sessionId": "ghi-789" }
{ "sessionId": "abc-123", "type": "run_input", "content": "..." }
{ "sessionId": "abc-123", "type": "token",     "content": "..." }
{ "sessionId": "abc-123", "type": "done",      "final": "..." }
```

---

## EngineFactory pattern

`EngineFactory` is a function `(sessionId: string, transport: Transport) => AgentEngine`. Each incoming WebSocket connection gets its own isolated engine instance.

### Minimal factory

```typescript
import type { EngineFactory } from '@backendkit-labs/agent-web';
import { AgentEngine } from '@backendkit-labs/agent-core';

const engineFactory: EngineFactory = (sessionId, transport) =>
  new AgentEngine({
    transport,
    sessionId,
    model:           { provider: 'openai', id: 'gpt-4o' },
    agents,
    tools,
    providers,
    defaultProvider: 'openai',
    defaultAgentId:  'general',
    maxIterations:   50,
    iterationMode:   'auto',
  });
```

### Factory with per-session memory

```typescript
import { createMemorySystem } from '@backendkit-labs/agent-core';
import * as path from 'path';
import * as os from 'os';

const engineFactory: EngineFactory = (sessionId, transport) => {
  // Isolated memory per session
  const sessDir = path.join(os.homedir(), '.bk-agent', 'sessions', sessionId);
  const memory = createMemorySystem({
    episodic:  { provider: 'json', path: path.join(sessDir, 'episodes.json') },
    semantic:  { provider: 'json', path: path.join(sessDir, 'knowledge.json') },
    procedural:{ provider: 'json', path: path.join(sessDir, 'patterns.json') },
  });

  return new AgentEngine({
    transport,
    sessionId,
    memorySystem: memory,
    ...baseConfig,
  });
};
```

### Factory with per-user context

Each WebSocket connection to `/chat` gets its own session with a random `sessionId`, and the factory builds a fresh engine for it. When `auth` is set, the authenticated user (the JWT `sub`) becomes the **owner** of the session: other users cannot see it in `/sessions` or `/monitor`. To load per-user settings in the engine, keep your own map from session to user, or read them inside your tools.

```typescript
const engineFactory: EngineFactory = (sessionId, transport) =>
  new AgentEngine({
    ...baseConfig,
    transport,
    sessionId,                 // also the session's id in metrics, monitor and audit
  });
```

---

## SessionManager

`SessionManager` creates, tracks and cleans up sessions. `AgentServer` creates one internally; you can also use it on your own WebSocket server.

```typescript
import { SessionManager } from '@backendkit-labs/agent-web';

const sessions = new SessionManager({
  engineFactory,
  maxIdleMs:   30 * 60 * 1000,  // close after 30 min of inactivity (default)
  maxSessions: 100,             // reject new sessions beyond this (default)
  monitorBus:  myMonitorBus,
  metrics:     myMetricsCollector,
  store:       myMetaStore,
});

const session = sessions.create(socket, userId);   // one per WebSocket connection; userId is the owner
sessions.get(session.id);
sessions.list();                                   // [{ id, createdAt, lastActivityAt, userId }]
sessions.destroy(session.id);
sessions.close();                                  // all sessions, on shutdown
```

---

## JWT authentication

`JwtAuth` validates Bearer tokens on HTTP routes and on the WebSocket handshake. Browsers cannot set headers on a WebSocket, so the token can also travel as the subprotocol `bearer, <jwt>`. A `?token=` query parameter still works unless `allowQueryToken: false`.

### Strict mode

For a server that other people reach, turn on both switches:

```ts
const auth = new JwtAuth({ secret: process.env.JWT_SECRET!, allowQueryToken: false }).hook();
new AgentServer({ engineFactory, host: '0.0.0.0', auth, strict: true, cors: ['https://app.example.com'] });
```

- `allowQueryToken: false` ignores `?token=` (a token in a URL lands in logs, proxies and history). A browser sends the
  token as the WebSocket subprotocol: `new WebSocket(url, ['bearer', jwt])`; `useAgentSession({ url, token })` in
  `agent-web-ui` does it for you.
- `strict: true` allows no CORS origin unless `cors` lists it, adds `X-Content-Type-Options`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`, and refuses (throws) to listen on a non-loopback `host` without `auth`.

### Setup

```typescript
import { AgentServer, JwtAuth } from '@backendkit-labs/agent-web';

const jwt = new JwtAuth({
  secret:     process.env.JWT_SECRET!,   // or publicKey for RS256 / ES256
  algorithms: ['HS256'],                 // accepted algorithms
  audience:   'agents',                  // optional checks
  issuer:     'https://login.company.com',
});

const server = new AgentServer({ port: 3000, engineFactory, auth: jwt.hook() });
```

The token must carry `sub` (the user id, owner of the sessions it opens); `email` and `roles` are read when present. `adminRole` in `AgentServerOptions` names the role that may see every session.

### Issuing tokens

`JwtAuth` only verifies. Issue tokens in your login endpoint with any JWT library and the same secret or key pair:

```typescript
import jwt from 'jsonwebtoken';

const token = jwt.sign({ sub: 'user-123', roles: ['admin'] }, process.env.JWT_SECRET!, { expiresIn: '24h' });
// The client sends it as Authorization: Bearer <token>, or as the WebSocket subprotocol `bearer, <token>`.
```

### Custom auth hook

If you use a different auth system (API keys, OAuth tokens), implement `AuthHook` directly:

```typescript
import type { AuthHook } from '@backendkit-labs/agent-web';

const apiKeyAuth: AuthHook = async (req, reply) => {
  const key = req.headers['x-api-key'];
  if (!key || !validApiKeys.has(key as string)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
};

const server = new AgentServer({ auth: apiKeyAuth, ...opts });
```

---

## Prometheus metrics

Requires `prom-client` to be installed. Exposes a `/metrics` endpoint with standard Prometheus counters and histograms.

```typescript
const server = new AgentServer({
  ...opts,
  metrics: {
    enabled:            true,
    path:               '/metrics',         // default
    prefix:             'bk_agent_',        // prepended to all metric names
    collectNodeMetrics: true,               // include Node.js process metrics
  },
});
```

### Exposed metrics

| Metric | Type | Description |
|--------|------|-------------|
| `bk_agent_sessions_active` | Gauge | Currently open sessions |
| `bk_agent_runs_total{status}` | Counter | Total runs by status (`success`, `error`) |
| `bk_agent_run_duration_seconds` | Histogram | Run latency distribution |
| Node.js metrics | Various | Memory, CPU, GC (when `collectNodeMetrics: true`) |

### Using MetricsCollector directly

```typescript
import { MetricsCollector } from '@backendkit-labs/agent-web';

const collector = new MetricsCollector({ prefix: 'my_agent_' });

// Record a run
const endRun = collector.runStarted();
// ... after it completes:
endRun('success');   // or endRun('error')

collector.sessionOpened();      // and sessionClosed(), messageReceived()

// Prometheus text format (serve it with collector.contentType)
const text = await collector.collect();
// # HELP my_agent_runs_total ...
// my_agent_runs_total{status="success"} 42
```

---

## Rate limiting

Requires `@fastify/rate-limit`. Applied globally to all routes:

```typescript
const server = new AgentServer({
  ...opts,
  rateLimiting: {
    max:        60,          // max 60 requests per IP
    timeWindow: '1 minute',  // sliding window
  },
});
```

When the limit is exceeded, the server responds with:
```json
{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded" }
```

---

## Session metadata store

By default, session metadata lives in memory and is lost on restart. Use `RedisSessionMetaStore` for durable metadata across restarts and horizontal scaling.

### In-memory (default)

```typescript
import { InMemorySessionMetaStore } from '@backendkit-labs/agent-web';

const server = new AgentServer({
  ...opts,
  store: new InMemorySessionMetaStore(),
});
```

### Redis store (requires ioredis or node-redis)

`RedisSessionMetaStore` is duck-typed — it accepts any Redis client that implements `.get()`, `.set()`, and `.del()`:

```typescript
import { RedisSessionMetaStore } from '@backendkit-labs/agent-web';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

const server = new AgentServer({
  ...opts,
  store: new RedisSessionMetaStore(redis, {
    ttlSeconds: 86400,    // keep session metadata for 24h
    prefix:     'bk:sess:', // key prefix
  }),
});
```

---

## MonitorBus

`MonitorBus` broadcasts all session events to connected `/monitor` WebSocket observers. Used by the Kanban board in `@backendkit-labs/agent-web-ui`.

### Standalone usage

```typescript
import { MonitorBus } from '@backendkit-labs/agent-web';

const monitor = new MonitorBus();

// Subscribe to all events (e.g. for logging or alerting)
const unsub = monitor.subscribe((frame) => {
  if (frame.type === 'done') {
    console.log(`[${frame.sessionId}] run completed`);
  }
  if (frame.type === 'error') {
    alerting.notify(`Agent error in session ${frame.sessionId}: ${frame.message}`);
  }
});

// Clean up
unsub();
```

---

## TriggerBus — cron, webhooks, queues

`TriggerBus` runs agents without a WebSocket client: on a schedule, on an incoming webhook, or for each job of a BullMQ queue. Each run gets a fresh engine from the factory and a `HeadlessTransport`, and shows up in the monitor.

Every trigger has the same three callbacks:

- `buildPrompt(payload)` returns the prompt. `payload` is `undefined` for cron, the parsed body for a webhook, and `job.data` for a queue job.
- `onComplete(result)` receives `{ sessionId, triggerName, firedAt, durationMs, output, events }`.
- `onError(err, triggerName)` is called when the run throws.

### Cron trigger (requires `node-cron`)

```typescript
import { TriggerBus } from '@backendkit-labs/agent-web';

const triggers = new TriggerBus(engineFactory)
  .addCron({
    name:        'daily-report',
    schedule:    '0 8 * * 1-5',     // weekdays at 8 AM
    buildPrompt: () => 'Generate the daily engineering standup summary from recent commits.',
    runOnStart:  false,             // true fires once when the bus starts
    onComplete:  ({ output }) => slack.send('#daily', output),
    onError:     (err, name) => logger.error(`[${name}]`, err),
  })
  .addCron({
    name:        'health-check',
    schedule:    '*/15 * * * *',
    buildPrompt: () => 'Check all API endpoints and report any that are down.',
    onComplete:  ({ output }) => { if (output.includes('DOWN')) pagerduty.alert(output); },
  });

const server = new AgentServer({ ...opts, triggers });
await server.start();   // cron jobs start with the server
```

### Webhook trigger

```typescript
const triggers = new TriggerBus(engineFactory)
  .addWebhook({
    name:        'github-pr',
    path:        '/webhooks/github',          // POST /webhooks/github (method: 'GET' | 'POST' | 'PUT')
    secret:      process.env.GITHUB_SECRET,   // HMAC X-Hub-Signature-256 over the raw body
    buildPrompt: (body) => {
      const pr = (body as { pull_request: { number: number; title: string; diff_url: string } }).pull_request;
      return `Review PR #${pr.number}: "${pr.title}"\n${pr.diff_url}`;
    },
    onComplete:  ({ output }) => github.comment(output),
  });
```

The webhook answers immediately and the run continues in the background; use `onComplete` to act on the result. If the payload is needed there, capture it in `buildPrompt`.

```bash
curl -X POST http://localhost:3000/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<hmac of the exact body>" \
  -d '{ "pull_request": { "number": 42, "title": "Add auth module", "diff_url": "..." } }'
```

### Queue trigger (BullMQ — requires `bullmq`)

```typescript
const triggers = new TriggerBus(engineFactory)
  .addQueue({
    name:        'document-processor',
    queueName:   'documents',
    connection:  process.env.REDIS_URL!,   // URL, or { host, port, password, username, db, tls }
    concurrency: 3,                        // default 1
    buildPrompt: (data) => `Summarize and extract key points:\n\n${(data as { content: string }).content}`,
    onComplete:  ({ output }) => saveSummary(output),
  });
```

A failed run is rethrown to BullMQ, so the job is marked failed and its retry policy applies. Jobs are published with BullMQ as usual (`new Queue('documents', { connection }).add('process', { id, content }, { attempts: 3 })`).

---

## HeadlessTransport

A `Transport` with no socket: it buffers every `AgentEvent` in memory. `TriggerBus` uses it for autonomous runs; use it to run an engine from a script.

```typescript
import { HeadlessTransport } from '@backendkit-labs/agent-web';

const transport = new HeadlessTransport();
const engine = new AgentEngine({ ...opts, transport });
await engine.run('Generate a daily report');

transport.getOutput();   // concatenated text of the 'token' events
transport.getEvents();   // every event, in order
```

---

## Full production example

JWT auth, Redis sessions, Prometheus metrics, a cron job, a webhook and a queue:

```typescript
import { AgentServer, JwtAuth, TriggerBus, RedisSessionMetaStore } from '@backendkit-labs/agent-web';
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry } from '@backendkit-labs/agent-core';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import Redis from 'ioredis';

const providers = new ProviderRegistry();
providers.register('deepseek', new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-chat' }));

const enterprise = createEnterpriseSetup({ vaultPath: process.env.VAULT_PATH!, providers, defaultProvider: 'deepseek' });
await enterprise.indexAll();

const triggers = new TriggerBus(enterprise.engineFactory)
  .addCron({
    name:        'weekly-digest',
    schedule:    '0 9 * * 1',
    buildPrompt: () => 'Generate a weekly digest of all knowledge base changes.',
    onComplete:  ({ output }) => slack.send('#general', output),
  })
  .addWebhook({
    name:        'support-ticket',
    path:        '/webhooks/support',
    secret:      process.env.WEBHOOK_SECRET,
    buildPrompt: (body) => {
      const t = body as { id: string; subject: string; description: string };
      return `Handle support ticket #${t.id}: ${t.subject}\n${t.description}`;
    },
  })
  .addQueue({
    name:        'email-processor',
    queueName:   'emails',
    connection:  process.env.REDIS_URL!,
    concurrency: 5,
    buildPrompt: (data) => `Draft a professional reply to this email:\n\n${(data as { body: string }).body}`,
  });

const server = new AgentServer({
  port:          3000,
  host:          '0.0.0.0',
  engineFactory: enterprise.engineFactory,
  auth:          new JwtAuth({ secret: process.env.JWT_SECRET!, allowQueryToken: false }).hook(),
  strict:        true,
  store:         new RedisSessionMetaStore(new Redis(process.env.REDIS_URL!)),
  cors:          ['https://app.company.com'],
  logger:        { level: 'info' },
  rateLimiting:  { max: 60, timeWindow: '1 minute' },
  metrics:       { enabled: true },
  maxIdleMs:     30 * 60 * 1000,
  triggers,
});

await server.start();
process.on('SIGTERM', () => server.stop());
```
