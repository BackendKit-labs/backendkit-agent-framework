'use client';
import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, RotateCcw, Check, ChevronDown, Database } from 'lucide-react';
import { Button, Input, Badge, cn } from '@/components/ui';
import { Topbar } from '@/components/layout/topbar';
import type { VaultDefinition } from '@/db/schema';

interface Message {
    role:       'user' | 'assistant';
    content:    string;
    ragSources?: string[];
}

interface Suggestion {
    type:    'replace' | 'append' | 'retag';
    preview: string;
    applied: boolean;
}

export default function ImprovePage() {
    const [vaults,          setVaults]          = useState<VaultDefinition[]>([]);
    const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
    const [vaultOpen,       setVaultOpen]       = useState(false);
    const [messages,        setMessages]        = useState<Message[]>([
        { role: 'assistant', content: 'Hola. Seleccioná un vault para activar el contexto RAG y te ayudo a mejorar notas. Sin vault funciono igual pero sin acceso al contenido existente.' },
    ]);
    const [input,       setInput]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const bottomRef  = useRef<HTMLDivElement>(null);
    const vaultRef   = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch('/api/vaults')
            .then(r => r.json())
            .then(d => setVaults(d.vaults ?? []))
            .catch(() => {});
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Close vault dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (vaultRef.current && !vaultRef.current.contains(e.target as Node)) {
                setVaultOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selectedVault = vaults.find(v => v.id === selectedVaultId) ?? null;

    async function sendMessage() {
        if (!input.trim() || loading) return;
        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const res  = await fetch('/api/improve', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: userMsg, history: messages, vaultId: selectedVaultId }),
            });
            const data = await res.json();
            setMessages(prev => [...prev, {
                role:       'assistant',
                content:    data.reply,
                ragSources: data.ragSources?.length ? data.ragSources : undefined,
            }]);
            if (data.suggestions) setSuggestions(data.suggestions);
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Error al conectar con el agente. Intentá de nuevo.' }]);
        }
        setLoading(false);
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar title="Mejora con AI" subtitle="Loop de mejora con el AI Design Agent" />

            <div className="flex flex-1 min-h-0 gap-4 p-6">
                {/* Chat */}
                <div className="flex flex-1 flex-col min-h-0 rounded-xl border border-border bg-card overflow-hidden">
                    {/* Header: agent info + vault picker */}
                    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10">
                            <Sparkles className="h-4 w-4 text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium">AI Design Agent</p>
                            <p className="text-xs text-muted-foreground">DeepSeek Reasoner · modo architect</p>
                        </div>

                        {/* Vault picker */}
                        <div className="ml-auto relative" ref={vaultRef}>
                            <button
                                onClick={() => setVaultOpen(o => !o)}
                                className={cn(
                                    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                                    selectedVault
                                        ? 'border-indigo-800/60 bg-indigo-950/30 text-indigo-300'
                                        : 'border-border text-muted-foreground hover:text-foreground hover:border-border/60',
                                )}
                            >
                                <Database className="h-3 w-3" />
                                <span className="max-w-[140px] truncate">
                                    {selectedVault ? selectedVault.label : 'Sin vault (sin RAG)'}
                                </span>
                                <ChevronDown className={cn('h-3 w-3 transition-transform', vaultOpen && 'rotate-180')} />
                            </button>

                            {vaultOpen && (
                                <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                                    <button
                                        onClick={() => { setSelectedVaultId(null); setVaultOpen(false); }}
                                        className={cn(
                                            'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors',
                                            !selectedVaultId && 'bg-accent/50',
                                        )}
                                    >
                                        <span className="text-muted-foreground">Sin vault (sin RAG)</span>
                                    </button>
                                    {vaults.map(v => (
                                        <button
                                            key={v.id}
                                            onClick={() => { setSelectedVaultId(v.id); setVaultOpen(false); }}
                                            className={cn(
                                                'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left',
                                                selectedVaultId === v.id && 'bg-indigo-950/30 text-indigo-300',
                                            )}
                                        >
                                            <Database className="h-3 w-3 shrink-0 opacity-60" />
                                            <span className="truncate">{v.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5 ml-3">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot" />
                            <span className="text-xs text-emerald-400">Conectado</span>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg, i) => (
                            <div key={i} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
                                <div className={cn(
                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                                    msg.role === 'assistant' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-primary/10 text-primary',
                                )}>
                                    {msg.role === 'assistant' ? '◈' : 'T'}
                                </div>
                                <div className="flex flex-col gap-1.5 max-w-[80%]">
                                    <div className={cn(
                                        'rounded-xl px-4 py-3 text-sm',
                                        msg.role === 'assistant'
                                            ? 'bg-muted/40 text-foreground'
                                            : 'bg-primary/10 text-foreground',
                                    )}>
                                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                    </div>
                                    {/* RAG source pills */}
                                    {msg.ragSources && msg.ragSources.length > 0 && (
                                        <div className="flex flex-wrap gap-1 px-1">
                                            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                                <Sparkles className="h-2.5 w-2.5" />RAG:
                                            </span>
                                            {msg.ragSources.map((src, j) => (
                                                <span
                                                    key={j}
                                                    className="inline-flex items-center rounded-full bg-indigo-950/40 border border-indigo-900/40 px-2 py-0.5 text-[10px] text-indigo-400"
                                                >
                                                    {src}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex gap-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-bold">◈</div>
                                <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-4 py-3">
                                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse-dot" style={{ animationDelay: '0ms' }} />
                                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse-dot" style={{ animationDelay: '200ms' }} />
                                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse-dot" style={{ animationDelay: '400ms' }} />
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="border-t border-border p-4">
                        {selectedVault && (
                            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-indigo-400/70">
                                <Sparkles className="h-3 w-3" />
                                RAG activo sobre <span className="font-medium text-indigo-400">{selectedVault.label}</span>
                                &mdash; el agente va a buscar contexto relevante en cada mensaje
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Input
                                placeholder="Pedile al agente que mejore, expanda, corrija o restructure..."
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                                className="flex-1"
                            />
                            <Button size="icon" onClick={sendMessage} disabled={!input.trim() || loading}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">Enter para enviar · Las sugerencias del agente aparecerán a la derecha</p>
                    </div>
                </div>

                {/* Suggestions panel */}
                <div className="flex w-64 shrink-0 flex-col gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3">Sugerencias del agente</p>
                        {suggestions.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-6 text-center">
                                <Sparkles className="h-6 w-6 text-muted-foreground/40" />
                                <p className="text-xs text-muted-foreground">Las sugerencias aparecerán aquí cuando el agente las genere.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {suggestions.map((s, i) => (
                                    <div key={i} className={cn('rounded-lg border p-3 space-y-2', s.applied ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-border')}>
                                        <div className="flex items-center justify-between">
                                            <Badge className="text-[10px] border border-indigo-800 text-indigo-400 bg-indigo-950/50">{s.type}</Badge>
                                            {s.applied
                                                ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                : <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, applied: true } : x))}>Aplicar</Button>
                                            }
                                        </div>
                                        <p className="text-xs text-muted-foreground line-clamp-3">{s.preview}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {suggestions.some(s => s.applied) && (
                        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-500">
                            <Check className="h-4 w-4" />
                            Guardar cambios
                        </Button>
                    )}

                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { setMessages([messages[0]]); setSuggestions([]); }}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reiniciar sesión
                    </Button>
                </div>
            </div>
        </div>
    );
}
