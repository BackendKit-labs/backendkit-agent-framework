import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { NavTabs } from '@/components/NavTabs';
import { Wifi, WifiOff, Loader2, Trash2 } from 'lucide-react';
import { useKanbanMonitor } from '@/hooks/useKanbanMonitor';
import { KanbanBoard } from './KanbanBoard';

const MONITOR_URL = import.meta.env.VITE_MONITOR_URL ?? 'ws://localhost:4001/monitor';

export default function KanbanApp() {
  const [monitorUrl, setMonitorUrl] = useState(MONITOR_URL);
  const [showUrlBar, setShowUrlBar] = useState(false);

  const { runs, status, activeSessions, connect, disconnect, clearDone } = useKanbanMonitor({
    url: monitorUrl,
  });

  const isConnected = status === 'connected';

  return (
    <div className="flex flex-col h-dvh bg-background">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-border bg-card shrink-0">
        <span className="text-sm font-semibold tracking-tight">BackendKit Agent</span>
        <NavTabs />

        {isConnected && activeSessions.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <Badge variant="secondary" className="text-xs gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
              {activeSessions.length} sesión{activeSessions.length !== 1 ? 'es' : ''} activa{activeSessions.length !== 1 ? 's' : ''}
            </Badge>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowUrlBar(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Configure monitor URL"
          >
            {status === 'connecting'   && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status === 'connected'    && <Wifi className="h-3.5 w-3.5 text-emerald-400" />}
            {status === 'disconnected' && <WifiOff className="h-3.5 w-3.5" />}
            <span className="capitalize">{status}</span>
          </button>

          <Separator orientation="vertical" className="h-4" />

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearDone} title="Limpiar completados">
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
          <span className="text-muted-foreground shrink-0">Monitor URL</span>
          <input
            className="flex-1 bg-transparent border border-input rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={monitorUrl}
            onChange={e => setMonitorUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setShowUrlBar(false);
                if (isConnected) { disconnect(); setTimeout(connect, 50); }
              }
            }}
            placeholder="ws://localhost:4001/monitor"
          />
          <Button size="sm" variant="secondary" className="h-6 text-xs px-2" onClick={() => setShowUrlBar(false)}>
            Done
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isConnected && (
        <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
          <div className="space-y-3">
            <p className="text-sm">Conectate al servidor para monitorear los agentes en tiempo real.</p>
            <Button size="sm" onClick={connect}>Conectar</Button>
          </div>
        </div>
      )}

      {/* Board */}
      {isConnected && (
        <div className="flex-1 overflow-hidden">
          <KanbanBoard runs={runs} />
        </div>
      )}
    </div>
  );
}
