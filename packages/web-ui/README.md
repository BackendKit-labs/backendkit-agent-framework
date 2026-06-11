# @backendkit-labs/agent-web-ui

React component library and hooks for building chat interfaces and real-time monitoring dashboards that connect to `@backendkit-labs/agent-web`.

Ships two ready-to-use app templates (`ChatApp`, `KanbanApp`) and composable primitives for building custom UIs.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-web-ui)](https://www.npmjs.com/package/@backendkit-labs/agent-web-ui)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [ChatApp — full chat interface](#chatapp--full-chat-interface)
- [KanbanApp — real-time monitor](#kanbanapp--real-time-monitor)
- [useAgentSession hook](#useagentsession-hook)
- [useKanbanMonitor hook](#usekanbanmonitor-hook)
- [Chat components](#chat-components)
- [Kanban components](#kanban-components)
- [NavTabs](#navtabs)
- [Building a custom chat UI](#building-a-custom-chat-ui)
- [Building a custom kanban](#building-a-custom-kanban)
- [Styling](#styling)

---

## Installation

```bash
npm install @backendkit-labs/agent-web-ui
```

**Peer dependencies** (install separately):

```bash
npm install react react-dom
```

**Import styles** in your app entry point:

```typescript
import '@backendkit-labs/agent-web-ui/style.css';
```

---

## Quick start

Drop in the full chat + kanban app with two components:

```typescript
import '@backendkit-labs/agent-web-ui/style.css';
import ChatApp from '@backendkit-labs/agent-web-ui/ChatApp';
import KanbanApp from '@backendkit-labs/agent-web-ui/KanbanApp';

// Full chat interface — connects to ws://localhost:3000/chat
function App() {
  return <ChatApp wsUrl="ws://localhost:3000/chat" />;
}

// Full kanban monitor — connects to ws://localhost:3000/monitor
function Monitor() {
  return <KanbanApp wsUrl="ws://localhost:3000/monitor" />;
}
```

---

## ChatApp — full chat interface

A complete streaming chat UI with message bubbles, tool call badges, markdown rendering, and an input bar.

```typescript
import ChatApp from '@backendkit-labs/agent-web-ui';

<ChatApp
  wsUrl="ws://localhost:3000/chat"
  token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  // optional JWT
  placeholder="Ask me anything..."                   // optional
  className="h-screen"                               // optional CSS class
/>
```

### With JWT authentication

When your `AgentServer` requires JWT auth, pass the token. The component appends `?token=<jwt>` to the WebSocket URL (which is how `agent-web` validates browser WS connections that can't set `Authorization` headers):

```typescript
// Log in and store the token
const { token } = await fetch('/api/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
}).then(r => r.json());

// Pass to ChatApp
<ChatApp wsUrl="ws://api.company.com/chat" token={token} />
```

---

## KanbanApp — real-time monitor

A Kanban board that shows all agent runs across all sessions in real time, organized into columns by status.

```typescript
import KanbanApp from '@backendkit-labs/agent-web-ui';

<KanbanApp
  wsUrl="ws://localhost:3000/monitor"
  token={adminToken}    // optional JWT
  className="h-screen"
/>
```

**Columns:**
- **Pending** — triggered runs waiting to start
- **Running** — actively executing (shows live token stream)
- **Done** — completed successfully
- **Error** — runs that failed

Each card shows: session ID, agent name, input prompt, output preview, tool calls, and duration.

---

## useAgentSession hook

The core hook for building custom chat UIs. Manages the WebSocket connection, message state, and streaming.

```typescript
import { useAgentSession } from '@backendkit-labs/agent-web-ui';

function MyChat() {
  const {
    messages,       // ChatMessage[] — full conversation
    status,         // 'idle' | 'connecting' | 'connected' | 'running' | 'error' | 'closed'
    isRunning,      // boolean — a run is in progress
    send,           // (text: string) => void — send a message
    abort,          // () => void — cancel the current run
  } = useAgentSession({
    wsUrl: 'ws://localhost:3000/chat',
    token: myJwtToken,         // optional
    onError: (err) => console.error(err),
    onDone:  (msg) => console.log('Run done:', msg),
  });

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id} className={`message ${msg.role}`}>
          {msg.content}
        </div>
      ))}
      <button onClick={() => send('Hello!')} disabled={isRunning}>
        Send
      </button>
    </div>
  );
}
```

### ChatMessage type

```typescript
interface ChatMessage {
  id:         string;
  role:       'user' | 'assistant' | 'system';
  content:    string;          // full text (built incrementally from tokens)
  toolCalls?: ToolCall[];      // tools called during this message
  isStreaming: boolean;        // true while tokens are still arriving
  timestamp:  number;
}

interface ToolCall {
  name:   string;
  args:   unknown;
  result: string;
}
```

### UseAgentSessionOptions

```typescript
interface UseAgentSessionOptions {
  wsUrl:      string;
  token?:     string;                    // JWT token
  onError?:   (err: string) => void;
  onDone?:    (finalMessage: string) => void;
  onConnect?: () => void;
  onClose?:   () => void;
}
```

### Connection status

```typescript
type ConnectionStatus =
  | 'idle'          // not yet connected
  | 'connecting'    // WebSocket opening
  | 'connected'     // open, waiting for input
  | 'running'       // agent is generating a response
  | 'error'         // connection or agent error
  | 'closed';       // connection closed
```

---

## useKanbanMonitor hook

Connects to the `/monitor` WebSocket endpoint and provides live run state for building custom kanban boards.

```typescript
import { useKanbanMonitor } from '@backendkit-labs/agent-web-ui';

function MyMonitor() {
  const {
    columns,    // KanbanColumn[] — { id, title, runs: KanbanRun[] }
    status,     // MonitorStatus
    sessionIds, // string[] — all active session IDs
  } = useKanbanMonitor({
    wsUrl: 'ws://localhost:3000/monitor',
    token: adminToken,
  });

  return (
    <div className="grid grid-cols-4 gap-4">
      {columns.map(col => (
        <div key={col.id}>
          <h3>{col.title} ({col.runs.length})</h3>
          {col.runs.map(run => (
            <div key={run.sessionId} className="card">
              <p>{run.input}</p>
              <p>{run.output}</p>
              <span>{run.agentId}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

### KanbanRun type

```typescript
interface KanbanRun {
  sessionId:  string;
  input:      string;         // the user message that started the run
  output:     string;         // accumulated output so far (live-updated)
  agentId:    string;         // which agent is running
  toolCalls:  KanbanToolCall[];
  startedAt:  number;
  endedAt?:   number;
  error?:     string;
}

interface KanbanToolCall {
  name:   string;
  args:   unknown;
  result: string;
}
```

### Column IDs

The four columns correspond to the run lifecycle:

| Column ID | Title | Condition |
|-----------|-------|-----------|
| `pending` | Pending | Run started, waiting |
| `running` | Running | Active token stream |
| `done` | Done | `done` event received |
| `error` | Error | `error` event received |

---

## Chat components

Individual chat components for building custom layouts:

### ChatWindow

Container that renders a scrollable list of messages:

```typescript
import { ChatWindow } from '@backendkit-labs/agent-web-ui';

<ChatWindow
  messages={messages}      // ChatMessage[]
  className="flex-1"
/>
```

### MessageBubble

A single message bubble with Markdown rendering and tool call badges:

```typescript
import { MessageBubble } from '@backendkit-labs/agent-web-ui';

<MessageBubble
  message={msg}           // ChatMessage
  showToolCalls={true}    // default: true
/>
```

### InputBar

The text input with send button and abort support:

```typescript
import { InputBar } from '@backendkit-labs/agent-web-ui';

<InputBar
  onSend={(text) => send(text)}
  onAbort={() => abort()}
  disabled={isRunning}
  placeholder="Ask me anything..."
/>
```

### ToolCallBadge

A collapsible badge showing a tool call and its result:

```typescript
import { ToolCallBadge } from '@backendkit-labs/agent-web-ui';

<ToolCallBadge
  toolCall={{
    name:   'search_files',
    args:   { query: 'authentication' },
    result: 'Found 3 files: src/auth/...',
  }}
/>
```

---

## Kanban components

### KanbanBoard

The board container:

```typescript
import { KanbanBoard } from '@backendkit-labs/agent-web-ui';

<KanbanBoard columns={columns} />   // KanbanColumn[]
```

### KanbanCard

A single run card:

```typescript
import { KanbanCard } from '@backendkit-labs/agent-web-ui';

<KanbanCard run={run} />   // KanbanRun
```

---

## NavTabs

A tab bar for switching between Chat and Kanban views with hash routing (`#chat`, `#kanban`):

```typescript
import { NavTabs } from '@backendkit-labs/agent-web-ui';

<NavTabs
  tabs={[
    { id: 'chat',   label: 'Chat' },
    { id: 'kanban', label: 'Monitor' },
  ]}
  activeTab={activeTab}
  onTabChange={setActiveTab}
/>
```

---

## Building a custom chat UI

Full example with custom styling:

```typescript
import { useAgentSession, MessageBubble, InputBar } from '@backendkit-labs/agent-web-ui';
import '@backendkit-labs/agent-web-ui/style.css';

function MyCustomChat({ wsUrl, token }: { wsUrl: string; token?: string }) {
  const { messages, status, isRunning, send, abort } = useAgentSession({
    wsUrl,
    token,
  });

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Status bar */}
      <div className="px-4 py-2 bg-white border-b text-sm text-gray-500">
        {status === 'connected' && 'Connected'}
        {status === 'running' && '⟳ Generating...'}
        {status === 'error' && '✗ Connection error'}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <div className="border-t bg-white p-4">
        <InputBar
          onSend={send}
          onAbort={abort}
          disabled={status !== 'connected' && !isRunning}
          placeholder="Type a message..."
        />
      </div>
    </div>
  );
}
```

---

## Building a custom kanban

```typescript
import { useKanbanMonitor } from '@backendkit-labs/agent-web-ui';
import '@backendkit-labs/agent-web-ui/style.css';

const COLUMN_COLORS = {
  pending: 'bg-yellow-50',
  running: 'bg-blue-50',
  done:    'bg-green-50',
  error:   'bg-red-50',
};

function MyKanban({ wsUrl }: { wsUrl: string }) {
  const { columns, status } = useKanbanMonitor({ wsUrl });

  if (status === 'connecting') return <p>Connecting to monitor...</p>;

  return (
    <div className="flex gap-4 p-4 h-screen overflow-x-auto">
      {columns.map(col => (
        <div key={col.id} className={`w-72 flex-shrink-0 rounded-lg p-3 ${COLUMN_COLORS[col.id]}`}>
          <h2 className="font-semibold mb-3">{col.title} ({col.runs.length})</h2>
          <div className="space-y-2">
            {col.runs.map(run => (
              <div key={run.sessionId} className="bg-white rounded p-3 shadow-sm text-sm">
                <div className="font-mono text-xs text-gray-400 mb-1">{run.sessionId.slice(0, 8)}</div>
                <div className="font-medium">{run.agentId}</div>
                <div className="text-gray-600 truncate">{run.input}</div>
                {run.output && (
                  <div className="text-gray-500 text-xs mt-1 truncate">{run.output.slice(0, 100)}</div>
                )}
                {run.toolCalls.length > 0 && (
                  <div className="text-xs text-blue-500 mt-1">
                    {run.toolCalls.length} tool call{run.toolCalls.length > 1 ? 's' : ''}
                  </div>
                )}
                {run.error && (
                  <div className="text-red-500 text-xs mt-1">{run.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Styling

The library uses Tailwind CSS internally. Import the stylesheet once in your app:

```typescript
import '@backendkit-labs/agent-web-ui/style.css';
```

### Custom CSS variables

Override the theme by setting CSS variables in your app's root:

```css
:root {
  --bk-primary:     #6366f1;   /* button and accent color */
  --bk-bg:          #ffffff;   /* chat background */
  --bk-user-bg:     #eff6ff;   /* user message bubble */
  --bk-assistant-bg:#f9fafb;   /* assistant message bubble */
}
```

### Integrating with existing Tailwind projects

If your project already uses Tailwind, add the library to your `content` array to avoid conflicts:

```javascript
// tailwind.config.js
export default {
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@backendkit-labs/agent-web-ui/src/**/*.{ts,tsx}',
  ],
};
```
