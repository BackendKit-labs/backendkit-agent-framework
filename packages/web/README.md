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
import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry } from '@backendkit-labs/agent-core';

const engineFactory: EngineFactory = (sessionId, transport) =>
  new AgentEngine({
    transport,
    sessionId,
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
  host?:   string;                    // default: '0.0.0.0'
  cors?:   string | string[];         // default: '*'
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

### Factory with userId from JWT

When JWT auth is enabled, the `sessionId` carries the authenticated user's context. You can also inject user-specific data:

```typescript
const engineFactory: EngineFactory = (sessionId, transport) => {
  // sessionId is set to the JWT 'sub' claim when JwtAuth is used
  const userConfig = getUserConfig(sessionId); // look up per-user settings

  return new AgentEngine({
    transport,
    sessionId,
    projectContext: `User: ${userConfig.name}\nRole: ${userConfig.role}`,
    ...baseConfig,
  });
};
```

---

## SessionManager

`SessionManager` creates, tracks, and cleans up sessions. It is created internally by `AgentServer`, but can also be used standalone.

```typescript
import { SessionManager } from '@backendkit-labs/agent-web';

const sessions = new SessionManager({
  engineFactory,
  maxIdleMs:   30 * 60 * 1000,  // close after 30 min of inactivity
  maxSessions: 100,
  monitorBus:  myMonitorBus,
  metrics:     myMetricsCollector,
  store:       myMetaStore,
});

// Lifecycle
const session = await sessions.getOrCreate('session-id', myTransport);
await sessions.close('session-id');
const all = sessions.list(); // SessionMeta[]
```

---

## JWT authentication

`JwtAuth` validates Bearer tokens in the `Authorization` header or `?token=` query parameter (useful for browser WebSocket connections that can't set custom headers).

### Setup

```typescript
import { AgentServer, JwtAuth } from '@backendkit-labs/agent-web';

const jwt = new JwtAuth({
  secret:        process.env.JWT_SECRET!,  // or use publicKey for RS256
  algorithm:     'HS256',                  // default
  sessionIdClaim:'sub',                    // JWT claim to use as sessionId
  expiresIn:     '24h',
});

const server = new AgentServer({
  port:          3000,
  engineFactory,
  auth:          jwt.hook(),               // AuthHook applied to all routes
});
```

### Issuing tokens (your login endpoint)

```typescript
import { JwtAuth } from '@backendkit-labs/agent-web';

const jwt = new JwtAuth({ secret: process.env.JWT_SECRET! });

// Issue a token for an authenticated user
const token = jwt.sign({
  sub:  'user-123',
  role: 'admin',
  name: 'Alice',
});

// Return to client — they send it as:
// Authorization: Bearer <token>
// or ws://host/chat?token=<token>
```

### Per-user session isolation

When `sessionIdClaim` is `'sub'`, every user gets their own session automatically. Two requests with the same token always hit the same session:

```typescript
const jwt = new JwtAuth({
  secret:         process.env.JWT_SECRET!,
  sessionIdClaim: 'sub',  // user ID as session key
});
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

// Record a completed run
const endRun = collector.startRun('session-abc');
// ... after run completes:
endRun('success');   // or endRun('error')

// Get Prometheus text format
const text = await collector.getMetrics();
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

`TriggerBus` lets autonomous agent runs happen without a WebSocket client. Runs are visible in the Kanban monitor.

### Cron trigger (requires `node-cron`)

```typescript
import { TriggerBus } from '@backendkit-labs/agent-web';

const triggers = new TriggerBus(engineFactory)
  .addCron({
    name:        'daily-report',
    schedule:    '0 8 * * 1-5',     // weekdays at 8 AM
    buildPrompt: () => 'Generate the daily engineering standup summary from recent commits.',
    runOnStart:  false,              // set true to fire immediately on server start
    onResult:    (out) => slack.send('#daily', out),
    onError:     (err) => logger.error('[daily-report]', err),
  })
  .addCron({
    name:        'health-check',
    schedule:    '*/15 * * * *',    // every 15 minutes
    buildPrompt: () => 'Check all API endpoints and report any that are down.',
    onResult:    (out) => { if (out.includes('DOWN')) pagerduty.alert(out); },
  });

const server = new AgentServer({ triggers, ...opts });
await server.start();
// Cron jobs start automatically with the server
```

### Webhook trigger

```typescript
const triggers = new TriggerBus(engineFactory)
  .addWebhook({
    name:        'github-pr',
    path:        '/webhooks/github',             // registered as POST /webhooks/github
    secret:      process.env.GITHUB_SECRET,      // HMAC X-Hub-Signature-256 validation (optional)
    buildPrompt: (body) => {
      const pr = body.pull_request;
      return `Review PR #${pr.number}: "${pr.title}"\n${pr.diff_url}`;
    },
    onResult: (out, body) => github.postReview(body.pull_request.number, out),
    onError:  (err) => logger.error('[github-pr]', err),
  })
  .addWebhook({
    name:        'jira-issue',
    path:        '/webhooks/jira',
    buildPrompt: (body) => `Analyze Jira issue ${body.issue.key}: ${body.issue.fields.summary}`,
    onResult:    (out) => jira.addComment(body.issue.key, out),
  });
```

**Testing a webhook:**

```bash
curl -X POST http://localhost:3000/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<hmac>" \
  -d '{ "pull_request": { "number": 42, "title": "Add auth module" } }'
```

### Queue trigger (BullMQ — requires `bullmq`)

```typescript
import { TriggerBus } from '@backendkit-labs/agent-web';

const triggers = new TriggerBus(engineFactory)
  .addQueue({
    name:        'document-processor',
    queueName:   'documents',           // BullMQ queue name
    connection:  process.env.REDIS_URL!, // Redis URL or connection object
    concurrency: 3,                     // process 3 jobs in parallel
    buildPrompt: (job) => {
      return `Summarize and extract key points from this document:\n\n${job.data.content}`;
    },
    onResult: (out, job) => {
      db.documents.update(job.data.id, { summary: out });
    },
    onError: (err, job) => {
      logger.error(`[queue] Failed to process document ${job?.data?.id}:`, err);
      // The error is re-thrown so BullMQ marks the job as failed and applies retry policy
    },
  });
```

**Publishing a job (from anywhere in your system):**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('documents', { connection: process.env.REDIS_URL! });

await queue.add('process-doc', {
  id:      'doc-456',
  content: 'Full document text...',
}, {
  attempts:    3,
  backoff:     { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail:     50,
});
```

### Queue connection options

```typescript
// URL string
connection: 'redis://localhost:6379'
connection: 'redis://:password@redis-host:6380/1'

// Connection object
connection: {
  host:     'redis-host',
  port:     6380,
  password: 'mypassword',
  username: 'default',
  db:       1,
  tls:      {},            // enable TLS
}
```

### CronTriggerDef with all options

```typescript
interface CronTriggerDef {
  name:         string;                        // unique name for the trigger
  schedule:     string;                        // standard cron expression
  buildPrompt:  (ts: Date) => string;          // returns the prompt to run
  agentId?:     string;                        // override default agent
  runOnStart?:  boolean;                       // fire immediately on server start
  onResult?:    (output: string) => void;
  onError?:     (err: Error) => void;
}
```

---

## HeadlessTransport

`HeadlessTransport` is a `Transport` implementation that buffers all `AgentEvent` objects in memory instead of streaming them over a socket. Used internally by `TriggerBus` for autonomous runs.

```typescript
import { HeadlessTransport } from '@backendkit-labs/agent-web';

const transport = new HeadlessTransport();

const engine = new AgentEngine({ ...opts, transport });
await engine.run('Generate a daily report');

// All events are buffered
const events = transport.getEvents();
const tokens = events
  .filter(e => e.type === 'chunk')
  .map(e => e.content)
  .join('');

console.log('Final output:', tokens);
```

---

## Full production example

A complete production server with JWT auth, Redis sessions, Prometheus metrics, cron jobs, webhook triggers, and BullMQ queue processing:

```typescript
import { AgentServer, JwtAuth, TriggerBus, RedisSessionMetaStore } from '@backendkit-labs/agent-web';
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry, DeepSeekProvider } from '@backendkit-labs/agent-core';
import Redis from 'ioredis';

// LLM providers
const providers = new ProviderRegistry();
providers.register('deepseek', new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model:  'deepseek-chat',
}));

// Enterprise setup (RAG + 6 agent profiles)
const enterprise = createEnterpriseSetup({
  vaultPath:       process.env.VAULT_PATH!,
  providers,
  defaultProvider: 'deepseek',
});
await enterprise.indexAll();

// Redis
const redis = new Redis(process.env.REDIS_URL!);

// JWT auth
const jwt = new JwtAuth({
  secret:         process.env.JWT_SECRET!,
  sessionIdClaim: 'sub',
});

// Autonomous triggers
const triggers = new TriggerBus(enterprise.engineFactory)
  .addCron({
    name:        'weekly-digest',
    schedule:    '0 9 * * 1',   // Mondays at 9 AM
    buildPrompt: () => 'Generate a weekly digest of all knowledge base changes.',
    onResult:    (out) => slack.send('#general', out),
  })
  .addWebhook({
    name:        'support-ticket',
    path:        '/webhooks/support',
    secret:      process.env.WEBHOOK_SECRET,
    buildPrompt: (body) => `Handle support ticket #${body.id}: ${body.subject}\n${body.description}`,
    onResult:    (out, body) => helpdesk.reply(body.id, out),
  })
  .addQueue({
    name:        'email-processor',
    queueName:   'emails',
    connection:  process.env.REDIS_URL!,
    concurrency: 5,
    buildPrompt: (job) => `Draft a professional reply to this email:\n\n${job.data.body}`,
    onResult:    (out, job) => emailService.send({ to: job.data.from, body: out }),
  });

// Server
const server = new AgentServer({
  port:          3000,
  engineFactory: enterprise.engineFactory,
  auth:          jwt.hook(),
  store:         new RedisSessionMetaStore(redis),
  cors:          ['https://app.company.com'],
  logger:        { level: 'info' },
  rateLimiting:  { max: 60, timeWindow: '1 minute' },
  metrics:       { enabled: true, prefix: 'bk_' },
  maxIdleMs:     30 * 60 * 1000,
  triggers,
});

await server.start();
console.log('Agent server running on :3000');

// Graceful shutdown
process.on('SIGTERM', () => server.stop());
```
