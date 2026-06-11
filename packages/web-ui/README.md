# @backendkit-labs/agent-web-ui

React UI library for [@backendkit-labs/agent-web](https://www.npmjs.com/package/@backendkit-labs/agent-web).

Two ready-made templates:
- **Chat** — streaming conversation with tool call badges, agent switching, markdown rendering
- **Kanban Monitor** — real-time board showing all agent activity across sessions

## Install

```bash
npm install @backendkit-labs/agent-web-ui
```

Import the styles in your entry point:

```typescript
import '@backendkit-labs/agent-web-ui/style.css';
```

## Full templates

```tsx
import { ChatApp } from '@backendkit-labs/agent-web-ui';

// Connects to ws://localhost:3000/chat by default
// Override with VITE_AGENT_SERVER_URL env var
export default function App() {
  return <ChatApp />;
}
```

```tsx
import { KanbanApp } from '@backendkit-labs/agent-web-ui';

// Connects to ws://localhost:3000/monitor by default
// Override with VITE_MONITOR_URL env var
export default function Monitor() {
  return <KanbanApp />;
}
```

## Hooks

### `useAgentSession`

```typescript
import { useAgentSession } from '@backendkit-labs/agent-web-ui';

const { messages, status, isRunning, activeAgent, connect, sendMessage, abort } =
  useAgentSession({ url: 'ws://localhost:3000/chat' });
```

### `useKanbanMonitor`

```typescript
import { useKanbanMonitor } from '@backendkit-labs/agent-web-ui';

const { runs, status, activeSessions, connect, clearDone } =
  useKanbanMonitor({ url: 'ws://localhost:3000/monitor' });
```

`runs` is a `KanbanRun[]` — each item has `sessionId`, `title`, `column` (`pending | running | waiting | done | error`), `toolCalls[]`, `tokens`, `startedAt`, `completedAt`.

## Individual components

```tsx
import { ChatWindow, InputBar, KanbanBoard } from '@backendkit-labs/agent-web-ui';
```

## Server

Pair with [@backendkit-labs/agent-web](https://www.npmjs.com/package/@backendkit-labs/agent-web) for the backend:

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({ port: 3000, engineFactory, cors: '*' });
await server.start();
// WS /chat    — chat sessions
// WS /monitor — real-time observer for the kanban board
```

## License

MIT
