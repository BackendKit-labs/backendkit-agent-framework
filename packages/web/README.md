# @backendkit-labs/agent-web

HTTP/WebSocket server layer for [@backendkit-labs/agent-core](https://www.npmjs.com/package/@backendkit-labs/agent-core).

Wraps `AgentEngine` in a Fastify 5 server and exposes it to browsers via WebSocket with streaming, multi-session management, and a real-time monitor bus.

## Install

```bash
npm install @backendkit-labs/agent-web @backendkit-labs/agent-core
```

## Quick start

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';
import type { EngineFactory } from '@backendkit-labs/agent-web';
import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry } from '@backendkit-labs/agent-core';

const engineFactory: EngineFactory = (sessionId, transport) =>
  new AgentEngine({ transport, /* ...your config */ });

const server = new AgentServer({
  port: 3000,
  engineFactory,
  cors: '*',
});

await server.start();
// WS /chat       — chat sessions
// WS /monitor    — real-time observer (read-only)
// GET /health    — { status, sessions, monitors }
// GET /sessions  — active session list
```

## WebSocket protocol

**Client → server** (`/chat`):
```json
{ "type": "input",  "content": "Your message" }
{ "type": "abort" }
```

**Server → client** — standard `AgentEvent` JSON frames: `token`, `tool_call`, `tool_result`, `agent_switch`, `block_start`, `done`, `error`, etc.

## Monitor bus

Connect to `WS /monitor` to observe all sessions in real time (read-only):

```json
{ "type": "monitor_hello",         "sessionIds": ["..."] }
{ "type": "monitor_session_open",  "sessionId": "..." }
{ "type": "monitor_session_close", "sessionId": "..." }
{ "sessionId": "...", "type": "run_input", "content": "..." }
{ "sessionId": "...", "type": "token", "content": "..." }
```

Use with [`@backendkit-labs/agent-web-ui`](https://www.npmjs.com/package/@backendkit-labs/agent-web-ui) for a ready-made React chat + kanban monitor UI.

## License

MIT
