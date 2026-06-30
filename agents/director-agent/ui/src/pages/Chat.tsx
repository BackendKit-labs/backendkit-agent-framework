import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, RotateCcw, ChevronDown, ChevronRight, Terminal, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { roleBg, primaryRole, type WsUser, type WsIncoming } from '../lib/ws';

interface ToolCall {
  id:            string;
  name:          string;
  server:        string;
  preview?:      string;
  status:        'running' | 'done' | 'error';
  resultPreview?: string;
  expanded:      boolean;
}

interface Message {
  id:          string;
  role:        'user' | 'assistant';
  content:     string;
  toolCalls:   ToolCall[];
  isStreaming: boolean;
}

interface Props {
  ws:   WebSocket;
  user: WsUser;
}

export default function Chat({ ws, user }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [status,   setStatus]   = useState<'connecting' | 'connected' | 'error'>('connected');
  const [sending,  setSending]  = useState(false);

  const role = primaryRole(user);

  const handleMessage = useCallback((ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as WsIncoming;

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
  }, []);

  useEffect(() => {
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('close',   () => setStatus('error'));
    ws.addEventListener('error',   () => setStatus('error'));
    return () => { ws.removeEventListener('message', handleMessage); };
  }, [ws, handleMessage]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function sendMessage() {
    const text = input.trim();
    if (!text || ws.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: text, toolCalls: [], isStreaming: false }]);
    ws.send(JSON.stringify({ type: 'chat', message: text }));
    setInput('');
    setSending(true);
  }

  function clearChat() {
    ws.send(JSON.stringify({ type: 'clear' }));
    setMessages([]);
  }

  function toggleTool(msgId: string, toolId: string) {
    setMessages(prev => prev.map(m =>
      m.id === msgId
        ? { ...m, toolCalls: m.toolCalls.map(t => t.id === toolId ? { ...t, expanded: !t.expanded } : t) }
        : m
    ));
  }

  return (
    <div className="flex flex-col h-full">
      {status !== 'connected' && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-1.5 text-xs shrink-0',
          status === 'connecting' ? 'bg-amber-400/10 text-amber-400' : 'bg-red-400/10 text-red-400'
        )}>
          <div className={cn('w-1.5 h-1.5 rounded-full', status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400')} />
          {status === 'connecting' ? 'Conectando...' : 'Director desconectado — recargá la página'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4">
              <Terminal className="w-8 h-8 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold mb-1">Director listo</h2>
            <p className="text-sm text-zinc-500 max-w-sm">
              Escribí en lenguaje natural. Puedo buscar en el vault, iniciar flows, monitorear el sistema y más.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={cn('flex gap-3 animate-fade-in', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                <Terminal className="w-4 h-4 text-zinc-400" />
              </div>
            )}

            <div className={cn('max-w-[75%] space-y-2', msg.role === 'user' ? 'items-end' : 'items-start')}>
              {msg.toolCalls.map(tool => (
                <div key={tool.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden text-xs">
                  <button
                    onClick={() => toggleTool(msg.id, tool.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-zinc-800/50 transition-colors text-left"
                  >
                    {tool.status === 'running' && <Loader2 className="w-3 h-3 text-zinc-400 animate-spin shrink-0" />}
                    {tool.status === 'done'    && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {tool.status === 'error'   && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                    <span className="text-zinc-500">[{tool.server}]</span>
                    <span className="text-zinc-300 font-medium">{tool.name}</span>
                    {tool.preview && <span className="text-zinc-500 truncate max-w-[200px]">{tool.preview}</span>}
                    <span className="ml-auto text-zinc-600">
                      {tool.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </span>
                  </button>
                  {tool.expanded && tool.resultPreview && (
                    <div className="px-3 py-2 border-t border-zinc-800 text-zinc-400 whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-y-auto">
                      {tool.resultPreview}
                    </div>
                  )}
                </div>
              ))}

              {(msg.content || msg.isStreaming) && (
                <div className={cn(
                  'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-zinc-700 text-zinc-100 rounded-tr-sm'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm'
                )}>
                  {msg.content}
                  {msg.isStreaming && !msg.content && (
                    <span className="inline-flex gap-1 ml-1">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full bg-current animate-pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </span>
                  )}
                  {msg.isStreaming && msg.content && <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse" />}
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5', roleBg(role))}>
                {(user.name ?? user.email ?? user.id)[0]?.toUpperCase()}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-zinc-800 bg-zinc-900/30 shrink-0">
        <div className="flex gap-2 items-end">
          <button
            onClick={clearChat}
            title="Limpiar chat"
            className="p-2.5 rounded-xl hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Escribí en lenguaje natural... (Enter para enviar)"
            rows={1}
            disabled={status !== 'connected' || sending}
            className={cn(
              'flex-1 resize-none px-4 py-3 rounded-xl text-sm',
              'bg-zinc-900 border border-zinc-800',
              'text-zinc-100 placeholder:text-zinc-600',
              'focus:outline-none focus:ring-2 focus:ring-zinc-600',
              'disabled:opacity-50 transition-all max-h-40 overflow-y-auto'
            )}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || status !== 'connected' || sending}
            className={cn(
              'p-3 rounded-xl transition-all shrink-0',
              'bg-zinc-100 text-zinc-900',
              'hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-zinc-400'
            )}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
