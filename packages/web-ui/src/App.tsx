import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { InputBar } from '@/components/chat/InputBar';
import { useAgentSession } from '@/hooks/useAgentSession';
import { Wifi, WifiOff, Loader2, Trash2 } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_AGENT_SERVER_URL ?? 'ws://localhost:4001/chat';

export default function App() {
  const [serverUrl, setServerUrl] = useState(SERVER_URL);
  const [showUrlBar, setShowUrlBar] = useState(false);

  const {
    messages, status, isRunning, activeAgent,
    connect, disconnect, sendMessage, abort, clearMessages,
  } = useAgentSession({ url: serverUrl });

  const isConnected = status === 'connected';

  return (
    <div className="flex flex-col h-dvh bg-background">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-border bg-card shrink-0">
        <span className="text-sm font-semibold tracking-tight">BackendKit Agent</span>

        {activeAgent && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <span>{activeAgent.icon}</span>
              <span>{activeAgent.name ?? activeAgent.id}</span>
            </Badge>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowUrlBar(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Configure server URL"
          >
            {status === 'connecting'   && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status === 'connected'    && <Wifi className="h-3.5 w-3.5 text-emerald-400" />}
            {status === 'disconnected' && <WifiOff className="h-3.5 w-3.5" />}
            <span className="capitalize">{status}</span>
          </button>

          <Separator orientation="vertical" className="h-4" />

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearMessages} title="Clear chat">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          {isConnected ? (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={disconnect}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" className="h-7 text-xs" onClick={connect}>
              Connect
            </Button>
          )}
        </div>
      </header>

      {/* URL config bar */}
      {showUrlBar && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-secondary/30 text-xs shrink-0">
          <span className="text-muted-foreground shrink-0">Server URL</span>
          <input
            className="flex-1 bg-transparent border border-input rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setShowUrlBar(false);
                if (isConnected) { disconnect(); setTimeout(connect, 50); }
              }
            }}
            placeholder="ws://localhost:4001/chat"
          />
          <Button size="sm" variant="secondary" className="h-6 text-xs px-2" onClick={() => setShowUrlBar(false)}>
            Done
          </Button>
        </div>
      )}

      <ChatWindow messages={messages} />

      <InputBar onSend={sendMessage} onAbort={abort} disabled={!isConnected} isRunning={isRunning} />
    </div>
  );
}
