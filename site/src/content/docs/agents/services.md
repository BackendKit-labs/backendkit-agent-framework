---
title: Agents as services
description: Serve an agent to a browser, to Claude or an IDE over MCP, or to other agents over an HTTP protocol.
---

An agent in a script helps one person. An agent as a **service** helps many programs. The framework serves it three ways, depending on who calls.

| Caller | Use | What it gives |
|---|---|---|
| A person in a browser | `agent-web` (+ `agent-web-ui`) | Streaming chat sessions over WebSocket, auth, metrics |
| Claude, an IDE, any MCP client | `mcp-server` (`AgentMCPServer`) or `createToolServer` | Your agent or your tools as MCP tools |
| Another agent, a supervisor | `agent-protocol` | An HTTP protocol with retries and a circuit breaker, and a control surface |

## To a browser: `agent-web`

```ts
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({ port: 3000, engineFactory, cors: '*' });
await server.start();
// WS  /chat      streaming chat sessions
// WS  /monitor   a real-time, read-only observer
// GET /health    { status, sessions, monitors }
```

An `EngineFactory` builds an engine per session, so each user gets their own memory and context. Included: JWT authentication (including a strict mode and a custom hook), Prometheus metrics, rate limiting, session stores (in memory or Redis), and a `TriggerBus` for [cron, webhooks and queues](../autonomous/).

`@backendkit-labs/agent-web-ui` adds the front end: ready-made React apps (`ChatApp`, and `KanbanApp` as a live monitor), the hooks they are built on (`useAgentSession`, `useKanbanMonitor`) and components to compose your own.

## To Claude, an IDE, any MCP client

`AgentMCPServer` exposes an agent as MCP tools: each tool turns its arguments into a prompt and the agent answers.

```ts
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { z } from 'zod';

const server = new AgentMCPServer({
  name: 'git-analyst',
  version: '1.0.0',
  port: 3010,
  tools: [
    {
      name: 'git_summarize',
      description: 'Summarize recent git commits grouped by features, bug fixes, and chores.',
      schema: { max_commits: z.number().optional().describe('Number of commits to analyze (default 20)') },
      buildPrompt: ({ max_commits }) => `Run: git log --oneline -${max_commits ?? 20}\nThen summarize by Features, Bug Fixes, Chores.`,
    },
  ],
});
```

If you do not want a model between the caller and the tool, `createToolServer` exposes plain tools that run **directly**. See [MCP](../../concepts/mcp/).

## To other agents: `agent-protocol`

`AgentServer` publishes an agent's capabilities, `AgentClient` calls them with retries and a circuit breaker, and a control surface lets a supervisor **pause, drain, budget, audit and steer** an agent and its [flows](../../guides/let-a-model-supervise-flows/).

A complete one, with a token. Without `authToken` the server listens only on loopback; with it, it can listen elsewhere, and every request must carry it:

```ts
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { z } from 'zod';

const server = new AgentMCPServer({
  name: 'git-analyst',
  version: '1.0.0',
  host: '0.0.0.0',
  port: 3010,
  authToken: process.env.MCP_TOKEN!,        // clients send  Authorization: Bearer <token>
  engineFactory,                             // builds the engine that answers each call
  tools: [{
    name: 'git_summarize',
    description: 'Summarize recent git commits',
    schema: { max_commits: z.number().optional() },
    buildPrompt: ({ max_commits }) => `Run: git log --oneline -${max_commits ?? 20}\nThen summarize by Features, Bug Fixes, Chores.`,
  }],
});
await server.start();
```

## Before you expose one

- A direct tool skips the engine's gates: give the server an `authorize` function, and require it for destructive tools (the server refuses to start without one).
- Bind to loopback unless you have a token. The HTTP servers refuse to listen elsewhere without authentication.
- The HTTP servers read at most 1 MiB of request body (more is answered `413`), answer a malformed body `400` and never send an internal error message to the client: the detail goes to the server's log. The `Bearer` scheme is matched without regard to case, as the standard says; the token itself is compared exactly, in constant time.
- Put a [budget](../../concepts/observability-and-cost/) on it: the examples read `AGENT_BUDGET_USD` to cap the spend of one call.

Reference: [`agent-web`](../../packages/web/), [`agent-web-ui`](../../packages/web-ui/), [`mcp-server`](../../packages/mcp-server/), [`agent-protocol`](../../packages/agent-protocol/).
