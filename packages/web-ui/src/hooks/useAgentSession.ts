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
  | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string };

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

export function useAgentSession({
  url,
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
  // Track the ID of the last pending tool_call badge
  const lastToolCallIdRef = useRef<string | null>(null);

  const handleEvent = useCallback((evt: AgentEventType) => {
    switch (evt.type) {
      case 'session_created':
        setSessionId(evt.sessionId);
        break;

      case 'token': {
        if (!streamingIdRef.current) {
          // Start a new streaming assistant message
          const id = uid();
          streamingIdRef.current = id;
          setMessages(prev => [...prev, {
            id,
            role: 'assistant',
            content: evt.content,
            agentId: activeAgent?.id,
            agentName: activeAgent?.name,
            agentIcon: activeAgent?.icon,
            isStreaming: true,
          }]);
        } else {
          setMessages(prev => prev.map(m =>
            m.id === streamingIdRef.current
              ? { ...m, content: m.content + evt.content }
              : m
          ));
        }
        break;
      }

      case 'tool_call': {
        // Close streaming message if open
        if (streamingIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m
          ));
          streamingIdRef.current = null;
        }
        const id = uid();
        lastToolCallIdRef.current = id;
        setMessages(prev => [...prev, {
          id,
          role: 'assistant',
          content: '',
          agentId: activeAgent?.id,
          agentName: activeAgent?.name,
          agentIcon: activeAgent?.icon,
          toolCalls: [{ id, name: evt.name, argsPreview: evt.args_preview, status: 'pending' }],
        }]);
        break;
      }

      case 'tool_result': {
        const tcId = lastToolCallIdRef.current;
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
        setActiveAgent({ id, name, icon });
        // Close current streaming message so next tokens open a fresh one
        if (streamingIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m
          ));
          streamingIdRef.current = null;
        }
        break;
      }

      case 'done':
      case 'ready':
        if (streamingIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m
          ));
          streamingIdRef.current = null;
        }
        setIsRunning(false);
        break;

      case 'error':
        setMessages(prev => [...prev, { id: uid(), role: 'system', content: `Error: ${evt.message}` }]);
        setIsRunning(false);
        streamingIdRef.current = null;
        break;

      case 'system':
        setMessages(prev => [...prev, { id: uid(), role: 'system', content: evt.text }]);
        break;

      case 'metrics':
        // Could surface in UI — for now ignored
        break;
    }
  }, [activeAgent]);

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
        const evt = JSON.parse(e.data as string) as AgentEventType;
        handleEvent(evt);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setIsRunning(false);
      streamingIdRef.current = null;
      wsRef.current = null;
    };

    ws.onerror = () => {
      setMessages(prev => [...prev, { id: uid(), role: 'system', content: 'WebSocket connection error.' }]);
      setStatus('disconnected');
    };
  }, [url, handleEvent]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

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
    setMessages([]);
    streamingIdRef.current = null;
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return () => { wsRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, status, isRunning, sessionId, activeAgent, connect, disconnect, sendMessage, abort, clearMessages };
}
