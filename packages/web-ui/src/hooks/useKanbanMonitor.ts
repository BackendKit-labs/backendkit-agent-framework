import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type KanbanColumn = 'pending' | 'running' | 'waiting' | 'done' | 'error';

export interface KanbanToolCall {
  id: string;
  name: string;
  argsPreview?: string;
  status: 'pending' | 'done' | 'error';
}

export interface KanbanRun {
  id: string;
  sessionId: string;
  title: string;
  column: KanbanColumn;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  toolCalls: KanbanToolCall[];
  tokens: number;
  startedAt: Date;
  completedAt?: Date;
}

export type MonitorStatus = 'disconnected' | 'connecting' | 'connected';

export interface UseKanbanMonitorOptions {
  url: string;
  autoConnect?: boolean;
}

export interface UseKanbanMonitorReturn {
  runs: KanbanRun[];
  status: MonitorStatus;
  activeSessions: string[];
  connect: () => void;
  disconnect: () => void;
  clearDone: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let runCounter = 0;
const mkRunId = (sessionId: string) => `${sessionId}-${++runCounter}`;

function truncate(text: string, max = 80): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useKanbanMonitor({
  url,
  autoConnect = false,
}: UseKanbanMonitorOptions): UseKanbanMonitorReturn {
  const [runs, setRuns] = useState<KanbanRun[]>([]);
  const [status, setStatus] = useState<MonitorStatus>('disconnected');
  const [activeSessions, setActiveSessions] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  // active run id per session
  const activeRunRef = useRef<Map<string, string>>(new Map());
  // tool call counter per run (for unique ids)
  const toolCounterRef = useRef<Map<string, number>>(new Map());

  const getActiveRun = (sessionId: string) => activeRunRef.current.get(sessionId);
  const setActiveRun = (sessionId: string, runId: string) => activeRunRef.current.set(sessionId, runId);
  const clearActiveRun = (sessionId: string) => activeRunRef.current.delete(sessionId);

  const nextToolId = (runId: string) => {
    const n = (toolCounterRef.current.get(runId) ?? 0) + 1;
    toolCounterRef.current.set(runId, n);
    return `${runId}-tc${n}`;
  };

  const updateRun = useCallback((runId: string, updater: (r: KanbanRun) => KanbanRun) => {
    setRuns(prev => prev.map(r => r.id === runId ? updater(r) : r));
  }, []);

  const handleFrame = useCallback((frame: Record<string, unknown>) => {
    const type = frame.type as string;

    // ── Monitor lifecycle ─────────────────────────────────────────────────────

    if (type === 'monitor_hello') {
      const ids = (frame.sessionIds as string[]) ?? [];
      setActiveSessions(ids);
      return;
    }

    if (type === 'monitor_session_open') {
      const sid = frame.sessionId as string;
      setActiveSessions(prev => [...new Set([...prev, sid])]);
      return;
    }

    if (type === 'monitor_session_close') {
      const sid = frame.sessionId as string;
      setActiveSessions(prev => prev.filter(s => s !== sid));

      // If session had an active run, mark it as error (disconnected mid-run)
      const activeRunId = getActiveRun(sid);
      if (activeRunId) {
        updateRun(activeRunId, r => ({ ...r, column: 'error', completedAt: new Date() }));
        clearActiveRun(sid);
      }
      return;
    }

    // ── Session events (all have sessionId) ───────────────────────────────────

    const sessionId = frame.sessionId as string | undefined;
    if (!sessionId) return;

    if (type === 'run_input') {
      const content = frame.content as string;
      const runId = mkRunId(sessionId);
      const newRun: KanbanRun = {
        id: runId,
        sessionId,
        title: truncate(content),
        column: 'pending',
        toolCalls: [],
        tokens: 0,
        startedAt: new Date(),
      };
      setActiveRun(sessionId, runId);
      setRuns(prev => [newRun, ...prev]);
      return;
    }

    const runId = getActiveRun(sessionId);
    if (!runId) return;

    if (type === 'block_start') {
      const agentId = frame.agent_id as string | undefined;
      const agentName = frame.agent_name as string | undefined;
      const agentIcon = frame.agent_icon as string | undefined;
      updateRun(runId, r => ({ ...r, column: 'running', agentId, agentName, agentIcon }));
      return;
    }

    if (type === 'agent_switch') {
      updateRun(runId, r => ({
        ...r,
        agentId: frame.to as string,
        agentName: frame.to_name as string | undefined,
        agentIcon: frame.to_icon as string | undefined,
      }));
      return;
    }

    if (type === 'token') {
      updateRun(runId, r => ({ ...r, tokens: r.tokens + ((frame.content as string)?.length ?? 0) }));
      return;
    }

    if (type === 'tool_call') {
      const toolId = nextToolId(runId);
      const tc: KanbanToolCall = {
        id: toolId,
        name: frame.name as string,
        argsPreview: frame.args_preview as string | undefined,
        status: 'pending',
      };
      updateRun(runId, r => ({ ...r, toolCalls: [...r.toolCalls, tc] }));
      return;
    }

    if (type === 'tool_result') {
      const success = frame.success as boolean;
      // Update the last pending tool call
      updateRun(runId, r => {
        const lastPending = [...r.toolCalls].reverse().find(tc => tc.status === 'pending');
        if (!lastPending) return r;
        return {
          ...r,
          toolCalls: r.toolCalls.map(tc =>
            tc.id === lastPending.id ? { ...tc, status: success ? 'done' : 'error' } : tc
          ),
        };
      });
      return;
    }

    if (type === 'done' || type === 'ready') {
      updateRun(runId, r => ({ ...r, column: 'done', completedAt: new Date() }));
      clearActiveRun(sessionId);
      return;
    }

    if (type === 'error') {
      updateRun(runId, r => ({ ...r, column: 'error', completedAt: new Date() }));
      clearActiveRun(sessionId);
      return;
    }
  }, [updateRun]);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (e: MessageEvent) => {
      try {
        const frame = JSON.parse(e.data as string) as Record<string, unknown>;
        handleFrame(frame);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
    };

    ws.onerror = () => setStatus('disconnected');
  }, [url, handleFrame]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const clearDone = useCallback(() => {
    setRuns(prev => prev.filter(r => r.column !== 'done' && r.column !== 'error'));
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return () => { wsRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { runs, status, activeSessions, connect, disconnect, clearDone };
}
