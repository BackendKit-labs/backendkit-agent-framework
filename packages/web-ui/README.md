# @backendkit-labs/agent-web-ui

React hooks and components for chat interfaces and real-time monitoring dashboards that connect to [`@backendkit-labs/agent-web`](../web).

It ships two ready-made apps (`ChatApp`, `KanbanApp`), the two hooks they are built on (`useAgentSession`, `useKanbanMonitor`) and the components to compose your own UI.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-web-ui)](https://www.npmjs.com/package/@backendkit-labs/agent-web-ui)

## Table of contents

- [Installation](#installation)
- [Ready-made apps](#ready-made-apps)
- [useAgentSession](#useagentsession)
- [useKanbanMonitor](#usekanbanmonitor)
- [Components](#components)
- [Authentication](#authentication)
- [Styling](#styling)

---

## Installation

```bash
npm install @backendkit-labs/agent-web-ui react react-dom
```

`react` and `react-dom` (>= 18) are peer dependencies. Import the stylesheet once, in your entry point:

```typescript
import '@backendkit-labs/agent-web-ui/style.css';
```

---

## Ready-made apps

`ChatApp` is a full streaming chat (messages, tool-call badges, input bar, a bar to change the server URL). `KanbanApp` is a live board of every agent run across sessions. Neither takes props: they read their URL from Vite environment variables and let the user change it at runtime.

```tsx
import '@backendkit-labs/agent-web-ui/style.css';
import { ChatApp, KanbanApp } from '@backendkit-labs/agent-web-ui';

export function Chat()    { return <ChatApp />; }     // VITE_AGENT_SERVER_URL, default ws://localhost:4001/chat
export function Monitor() { return <KanbanApp />; }   // VITE_MONITOR_URL,      default ws://localhost:4001/monitor
```

To pass a URL or a token from your own code, build the screen with the hooks below.

---

## useAgentSession

Manages one chat session over WebSocket: the connection, the message list (built from the streamed tokens and tool events) and the active agent.

```tsx
import { useAgentSession } from '@backendkit-labs/agent-web-ui';

function MyChat({ token }: { token?: string }) {
  const {
    messages,      // ChatMessage[]
    status,        // 'disconnected' | 'connecting' | 'connected'
    isRunning,     // a run is in progress
    sessionId,     // string | null — assigned by the server
    activeAgent,   // { id, name?, icon? } | null — the agent answering now
    sendMessage,   // (content: string) => void
    abort,         // () => void — cancel the current run
    connect, disconnect, clearMessages,
  } = useAgentSession({
    url: 'ws://localhost:3000/chat',
    token,               // optional, see Authentication
    autoConnect: true,   // default
  });

  return (
    <div>
      {messages.map(m => <p key={m.id}><b>{m.agentName ?? m.role}:</b> {m.content}</p>)}
      <button disabled={isRunning || status !== 'connected'} onClick={() => sendMessage('Hello!')}>Send</button>
      {isRunning && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string; agentName?: string; agentIcon?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  argsPreview?: string;
  status: 'pending' | 'done' | 'error';
  preview?: string;      // first characters of the result
}
```

The raw events the hook understands are exported as `AgentEventType` (the same events `agent-web` sends: `token`, `tool_call`, `tool_result`, `agent_switch`, `metrics`, `budget_exceeded`, `done`, `error`, ...).

---

## useKanbanMonitor

Connects to the `/monitor` endpoint of `agent-web` and keeps one card per agent run, across every session.

```tsx
import { useKanbanMonitor, KanbanBoard } from '@backendkit-labs/agent-web-ui';

function MyMonitor({ adminToken }: { adminToken: string }) {
  const { runs, status, activeSessions, clearDone } = useKanbanMonitor({
    url: 'ws://localhost:3000/monitor',
    token: adminToken,
  });

  return (
    <>
      <header>{status} · {activeSessions.length} sessions <button onClick={clearDone}>Clear done</button></header>
      <KanbanBoard runs={runs} />
    </>
  );
}
```

```typescript
type KanbanColumn = 'pending' | 'running' | 'waiting' | 'done' | 'error';

interface KanbanRun {
  id: string;
  sessionId: string;
  title: string;
  column: KanbanColumn;
  agentId?: string; agentName?: string; agentIcon?: string;
  toolCalls: KanbanToolCall[];   // { id, name, argsPreview?, status }
  tokens: number;
  startedAt: Date;
  completedAt?: Date;
}
```

---

## Components

| Component | Props | What it renders |
|---|---|---|
| `ChatWindow` | `messages: ChatMessage[]` | The scrolling list of messages |
| `MessageBubble` | `message: ChatMessage` | One message, with its agent and tool calls |
| `ToolCallBadge` | `toolCall: ToolCall` | One tool call and its status |
| `InputBar` | `onSend(content)`, `onAbort()`, `disabled`, `isRunning` | The input box with send and stop |
| `KanbanBoard` | `runs: KanbanRun[]` | The columns of the monitor |
| `KanbanCard` | `run: KanbanRun` | One run |
| `NavTabs` | none | Tabs to switch between chat and monitor |

A custom chat is the hook plus these pieces:

```tsx
import { useAgentSession, ChatWindow, InputBar } from '@backendkit-labs/agent-web-ui';

function Chat({ url }: { url: string }) {
  const { messages, isRunning, status, sendMessage, abort } = useAgentSession({ url });
  return (
    <div className="flex h-screen flex-col">
      <ChatWindow messages={messages} />
      <InputBar onSend={sendMessage} onAbort={abort} isRunning={isRunning} disabled={status !== 'connected'} />
    </div>
  );
}
```

---

## Authentication

When `agent-web` runs with `JwtAuth`, pass the JWT as `token`. Both hooks send it as the WebSocket subprotocol `bearer, <jwt>`, never in the URL, so it works with `JwtAuth({ allowQueryToken: false })` and does not end up in proxy logs.

---

## Styling

The components use Tailwind CSS with shadcn/ui theme variables. Import `@backendkit-labs/agent-web-ui/style.css` once. To change the theme, override the variables (HSL values without `hsl()`) on `:root`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --muted: 240 4.8% 95.9%;
}
```

If your project already uses Tailwind, add the package sources to `content` so its classes are generated:

```javascript
// tailwind.config.js
export default {
  content: ['./src/**/*.{ts,tsx}', './node_modules/@backendkit-labs/agent-web-ui/src/**/*.{ts,tsx}'],
};
```
