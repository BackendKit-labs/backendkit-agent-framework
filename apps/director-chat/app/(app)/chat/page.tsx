'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Send, RotateCcw, ChevronDown, ChevronRight, Terminal, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWsUrl, roleBg, primaryRole, type WsUser, type WsIncoming } from '@/lib/ws';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  name: string;
  server: string;
  preview?: string;
  status: 'running' | 'done' | 'error';
  resultPreview?: string;
  expanded: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCall[];
  isStreaming: boolean;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { data: session } = useSession();
  const wsRef     = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const [user,     setUser]     = useState<WsUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [status,   setStatus]   = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [sending,  setSending]  = useState(false);

  useEffect(() => {
    if (session?.user) {
      setUser({ id: session.user.id, name: session.user.name, email: session.user.email, roles: session.user.roles });
    }
  }, [session]);

  // ── WebSocket ───────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    const token = session?.user?.authToken;
    if (!token) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setStatus('connecting');

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsIncoming;

      if (msg.type === 'ready') {
        if (msg.auth_required) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        } else {
          setStatus('connected');
        }
        return;
      }

      if (msg.type === 'auth_ok') {
        setStatus('connected');
        return;
      }

      if (msg.type === 'auth_error') {
        setStatus('error');
        return;
      }

      if (msg.type === 'token') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + msg.content }];
          }
          return [...prev, { id: Date.now().toString(), role: 'assistant', content: msg.content, toolCalls: [], isStreaming: true }];
        });
        return;
      }

      if (msg.type === 'tool_call') {
        const toolId = `${msg.name}-${Date.now()}`;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          const newTool: ToolCall = { id: toolId, name: msg.name, server: msg.server, preview: msg.preview, status: 'running', expanded: false };
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, toolCalls: [...last.toolCalls, newTool] }];
          }
          return [...prev, { id: Date.now().toString(), role: 'assistant', content: '', toolCalls: [newTool], isStreaming: true }];
        });
        return;
      }

      if (msg.type === 'tool_result') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            const tools = last.toolCalls.map(t =>
              t.name === msg.name && t.status === 'running'
                ? { ...t, status: msg.success ? 'done' as const : 'error' as const, resultPreview: msg.preview }
                : t
            );
            return [...prev.slice(0, -1), { ...last, toolCalls: tools }];
          }
          return prev;
        });
        return;
      }

      if (msg.type === 'done') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return [...prev.slice(0, -1), { ...last, isStreaming: false }];
          return prev;
        });
        setSending(false);
        inputRef.current?.focus();
        return;
      }

      if (msg.type === 'error') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return [...prev.slice(0, -1), { ...last, content: last.content || `Error: ${msg.message}`, isStreaming: false }];
          return [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${msg.message}`, toolCalls: [], isStreaming: false }];
        });
        setSending(false);
        return;
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('error');
  }, [session]);

  useEffect(() => {
    if (!session?.user?.authToken) return;
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]); // eslint-disable-line

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  function sendMessage() {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: text, toolCalls: [], isStreaming: false }]);
    wsRef.current.send(JSON.stringify({ type: 'chat', message: text }));
    setInput('');
    setSending(true);
  }

  function clearChat() {
    wsRef.current?.send(JSON.stringify({ type: 'clear' }));
    setMessages([]);
  }

  function toggleTool(msgId: string, toolId: string) {
    setMessages(prev => prev.map(m =>
      m.id === msgId
        ? { ...m, toolCalls: m.toolCalls.map(t => t.id === toolId ? { ...t, expanded: !t.expanded } : t) }
        : m
    ));
  }

  const role = user ? primaryRole(user) : 'viewer';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* WS status bar — only when not connected */}
      {status !== 'connected' && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-1.5 text-xs shrink-0',
          status === 'connecting' ? 'bg-amber-400/10 text-amber-400' : 'bg-red-400/10 text-red-400'
        )}>
          <div className={cn('w-1.5 h-1.5 rounded-full', status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400')} />
          {status === 'connecting' ? 'Conectando al Director...' : 'Director desconectado'}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Terminal className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Director listo</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Escribí en lenguaje natural. Puedo buscar en el vault, iniciar flows, monitorear el sistema y más.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={cn('flex gap-3 animate-fade-in', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <Terminal className="w-4 h-4 text-primary" />
              </div>
            )}

            <div className={cn('max-w-[75%] space-y-2', msg.role === 'user' ? 'items-end' : 'items-start')}>
              {msg.toolCalls.map(tool => (
                <div key={tool.id} className="rounded-lg border border-border bg-secondary/50 overflow-hidden text-xs">
                  <button
                    onClick={() => toggleTool(msg.id, tool.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                  >
                    {tool.status === 'running' && <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />}
                    {tool.status === 'done'    && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {tool.status === 'error'   && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                    <span className="text-muted-foreground">[{tool.server}]</span>
                    <span className="text-foreground font-medium">{tool.name}</span>
                    {tool.preview && <span className="text-muted-foreground truncate max-w-[200px]">{tool.preview}</span>}
                    <span className="ml-auto text-muted-foreground">
                      {tool.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </span>
                  </button>
                  {tool.expanded && tool.resultPreview && (
                    <div className="px-3 py-2 border-t border-border text-muted-foreground whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-y-auto">
                      {tool.resultPreview}
                    </div>
                  )}
                </div>
              ))}

              {(msg.content || msg.isStreaming) && (
                <div className={cn(
                  'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-secondary border border-border text-foreground rounded-tl-sm'
                )}>
                  {msg.content}
                  {msg.isStreaming && !msg.content && <span className="inline-flex gap-1 ml-1">
                    {[0,1,2].map(i => <span key={i} className="w-1 h-1 rounded-full bg-current animate-pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}
                  </span>}
                  {msg.isStreaming && msg.content && <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse-dot" />}
                </div>
              )}
            </div>

            {msg.role === 'user' && user && (
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5', roleBg(role))}>
                {(user.name ?? user.email ?? user.id)[0]?.toUpperCase()}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-border bg-secondary/10 shrink-0">
        <div className="flex gap-2 items-end">
          <button
            onClick={clearChat}
            title="Limpiar chat"
            className="p-2.5 rounded-xl hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Escribí en lenguaje natural... (Enter para enviar, Shift+Enter para nueva línea)"
            rows={1}
            disabled={status !== 'connected' || sending}
            className={cn(
              'flex-1 resize-none px-4 py-3 rounded-xl text-sm',
              'bg-secondary border border-border',
              'text-foreground placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50',
              'disabled:opacity-50 transition-all max-h-40 overflow-y-auto'
            )}
            style={{ height: 'auto' }}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || status !== 'connected' || sending}
            className={cn(
              'p-3 rounded-xl transition-all shrink-0',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-primary/40'
            )}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
