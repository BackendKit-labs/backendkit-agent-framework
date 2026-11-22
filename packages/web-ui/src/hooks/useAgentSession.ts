import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentEventType =
  | { type: 'session_created'; sessionId: string }
  | { type: 'ready' }
  | { type: 'token'; content: string; agent_id?: string }
  | { type: 'tool_call'; name: string; args_preview?: string }
  | { type: 'tool_result'; name: string; success: boolean; preview?: string }
  | { type: 'agent_switch'; from: string; to: string; to_name?: string; to_icon?: string }
  | { type: 'block_start'; agent_id: string; agent_name?: string; agent_icon?: string }
  | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
  | { type: 'thinking'; label: string }
  | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number; cache_read_tokens?: number; cache_write_tokens?: number }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'budget_exceeded'; usage: { runCostUsd: number; dayCostUsd: number; budgetExceeded: 'perRun' | 'perDay' } };

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ToolCall {
  id: string;
  name: string;
  argsPreview?: string;
  status: 'pending' | 'done' | 'error';
  preview?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface UseAgentSessionOptions {
  url: string;
  /**
   * JWT for a server that does not accept `?token=` (JwtAuth `allowQueryToken: false`). It travels as the
   * WebSocket subprotocol `bearer, <jwt>`, never in the URL.
   */
  token?: string;
  autoConnect?: boolean;
}

export interface UseAgentSessionReturn {
  messages: ChatMessage[];
  status: ConnectionStatus;
  isRunning: boolean;
  sessionId: string | null;
  activeAgent: { id: string; name?: string; icon?: string } | null;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  abort: () => void;
  clearMessages: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

let msgCounter = 0;
const uid = () => `msg-${++msgCounter}`;

/** Streamed text is applied to the message list at most this often (about one frame). */
const TOKEN_FLUSH_MS = 16;

export function useAgentSession({
  url,
  token,
  autoConnect = false,
}: UseAgentSessionOptions): UseAgentSessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<{ id: string; name?: string; icon?: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Track the ID of the assistant message currently being streamed
  const streamingIdRef = useRef<string | null>(null);
  // Tool calls still waiting for their result, oldest first (several can be in flight at once)
  const pendingToolsRef = useRef<Array<{ id: string; name: string }>>([]);
  // Latest active agent, readable from socket callbacks that were created earlier
  const activeAgentRef = useRef<{ id: string; name?: string; icon?: string } | null>(null);
  // Token text received but not yet applied. A model streams dozens of tokens a second; applying each one
  // re-mapped the whole message list and re-rendered (and re-parsed the markdown of) the bubble per token.
  const pendingTextRef = useRef<{ id: string; text: string } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Applies the buffered token text in one state update. Called by the timer and before any other event. */
  const flushTokens = useCallback(() => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const pending = pendingTextRef.current;
    pendingTextRef.current = null;
    if (!pending) return;
    setMessages(prev => prev.map(m => (m.id === pending.id ? { ...m, content: m.content + pending.text } : m)));
  }, []);

  /**
   * Stop the streaming flag on the open assistant message. The id must be captured BEFORE the
   * ref is cleared: setMessages updaters run later, and would otherwise compare against null.
   */
  const closeStreaming = useCallback(() => {
    flushTokens();
    const id = streamingIdRef.current;
    streamingIdRef.current = null;
    if (id) setMessages(prev => prev.map(m => (m.id === id ? { ...m, isStreaming: false } : m)));
  }, [flushTokens]);

  const handleEvent = useCallback((evt: AgentEventType) => {
    // Anything but a token first lands the text buffered before it, so order is preserved.
    if (evt.type !== 'token') flushTokens();
    switch (evt.type) {
      case 'session_created':
        setSessionId(evt.sessionId);
        break;

      case 'token': {
        const openId = streamingIdRef.current;
        if (!openId) {
          // Start a new streaming assistant message
          const id = uid();
          const agent = activeAgentRef.current;
          streamingIdRef.current = id;
          setMessages(prev => [...prev, {
            id,
            role: 'assistant',
            content: evt.content,
            agentId: agent?.id,
            agentName: agent?.name,
            agentIcon: agent?.icon,
            isStreaming: true,
          }]);
        } else {
          const pending = pendingTextRef.current;
          pendingTextRef.current = { id: openId, text: (pending?.id === openId ? pending.text : '') + evt.content };
          flushTimerRef.current ??= setTimeout(flushTokens, TOKEN_FLUSH_MS);
        }
        break;
      }

      case 'tool_call': {
        closeStreaming();
        const id = uid();
        const agent = activeAgentRef.current;
        pendingToolsRef.current.push({ id, name: evt.name });
        setMessages(prev => [...prev, {
          id,
          role: 'assistant',
          content: '',
          agentId: agent?.id,
          agentName: agent?.name,
          agentIcon: agent?.icon,
          toolCalls: [{ id, name: evt.name, argsPreview: evt.args_preview, status: 'pending' }],
        }]);
        break;
      }

      case 'tool_result': {
        // Match the oldest in-flight call with the same name (results can arrive per call)
        const idx = pendingToolsRef.current.findIndex(t => t.name === evt.name);
        const tcId = idx >= 0 ? pendingToolsRef.current.splice(idx, 1)[0].id : null;
        if (tcId) {
          setMessages(prev => prev.map(m =>
            m.toolCalls?.some(tc => tc.id === tcId)
              ? {
                  ...m,
                  toolCalls: m.toolCalls!.map(tc =>
                    tc.id === tcId
                      ? { ...tc, status: evt.success ? 'done' : 'error', preview: evt.preview }
                      : tc
                  ),
                }
              : m
          ));
        }
        break;
      }

      case 'agent_switch':
      case 'block_start': {
        const id = evt.type === 'agent_switch' ? evt.to : evt.agent_id;
        const name = evt.type === 'agent_switch' ? evt.to_name : evt.agent_name;
        const icon = evt.type === 'agent_switch' ? evt.to_icon : evt.agent_icon;
        activeAgentRef.current = { id, name, icon };
        setActiveAgent({ id, name, icon });
        // Close current streaming message so next tokens open a fresh one
        closeStreaming();
        break;
      }

      case 'done':
      case 'ready':
        closeStreaming();
        setIsRunning(false);
        break;

      case 'error':
        closeStreaming();
        setMessages(prev => [...prev, { id: uid(), role: 'system', content: `Error: ${evt.message}` }]);
        setIsRunning(false);
        break;

      case 'system':
        setMessages(prev => [...prev, { id: uid(), role: 'system', content: evt.text }]);
        break;

      case 'budget_exceeded':
        setMessages(prev => [...prev, {
          id: uid(), role: 'system',
          content: `Budget exceeded (${evt.usage.budgetExceeded}): run $${evt.usage.runCostUsd.toFixed(4)}, day $${evt.usage.dayCostUsd.toFixed(4)}. Run stopped.`,
        }]);
        break;

      case 'metrics':
        // Could surface in UI — for now ignored
        break;
    }
  }, [closeStreaming, flushTokens]);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('connecting');
    const ws = token ? new WebSocket(url, ['bearer', token]) : new WebSocket(url);
    wsRef.current = ws;

    // A socket that was replaced by a newer connect() still fires its own close/error/message later: those must not
    // touch the state or the ref of the connection that is current now.
    const current = () => wsRef.current === ws;

    ws.onopen = () => { if (current()) setStatus('connected'); };

    ws.onmessage = (e: MessageEvent) => {
      if (!current()) return;
      try {
        const evt = JSON.parse(e.data as string) as AgentEventType;
        handleEvent(evt);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!current()) return;
      setStatus('disconnected');
      setIsRunning(false);
      closeStreaming();
      pendingToolsRef.current = [];
      wsRef.current = null;
    };

    ws.onerror = () => {
      if (!current()) return;
      setMessages(prev => [...prev, { id: uid(), role: 'system', content: 'WebSocket connection error.' }]);
      setStatus('disconnected');
    };
  }, [url, token, handleEvent, closeStreaming]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    // The closed socket's own onclose is ignored (it is no longer current), so the state is set here.
    setStatus('disconnected');
    setIsRunning(false);
    closeStreaming();
    pendingToolsRef.current = [];
  }, [closeStreaming]);

  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { id: uid(), role: 'user', content }]);
    setIsRunning(true);
    streamingIdRef.current = null;
    wsRef.current.send(JSON.stringify({ type: 'input', content }));
  }, []);

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'abort' }));
    setIsRunning(false);
  }, []);

  const clearMessages = useCallback(() => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    pendingTextRef.current = null;
    setMessages([]);
    streamingIdRef.current = null;
    pendingToolsRef.current = [];
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, status, isRunning, sessionId, activeAgent, connect, disconnect, sendMessage, abort, clearMessages };
}
