// Styles — consumers import via: import '@backendkit-labs/agent-web-ui/style.css'
import './index.css';

// Hooks
export { useAgentSession } from './hooks/useAgentSession';
export type {
  ChatMessage,
  ToolCall,
  ConnectionStatus,
  UseAgentSessionOptions,
  UseAgentSessionReturn,
  AgentEventType,
  MessageRole,
} from './hooks/useAgentSession';

export { useKanbanMonitor } from './hooks/useKanbanMonitor';
export type {
  KanbanRun,
  KanbanToolCall,
  KanbanColumn,
  MonitorStatus,
  UseKanbanMonitorOptions,
  UseKanbanMonitorReturn,
} from './hooks/useKanbanMonitor';

// Chat components
export { ChatWindow } from './components/chat/ChatWindow';
export { MessageBubble } from './components/chat/MessageBubble';
export { InputBar } from './components/chat/InputBar';
export { ToolCallBadge } from './components/chat/ToolCallBadge';

// Kanban components
export { KanbanBoard } from './templates/kanban/KanbanBoard';
export { KanbanCard } from './templates/kanban/KanbanCard';

// Nav
export { NavTabs } from './components/NavTabs';

// App templates
export { default as ChatApp } from './App';
export { default as KanbanApp } from './templates/kanban/KanbanApp';

// Utils
export { cn } from './lib/utils';
