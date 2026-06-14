'use client';
import { useState, useRef } from 'react';
import {
    Search, Database, FileText, Tag,
    ChevronRight, ChevronDown, RefreshCw,
    Settings2, Check, X, Folder, FolderOpen,
    Sparkles, Loader2,
} from 'lucide-react';
import { Input, Badge, cn } from '@/components/ui';
import type { AuditItem, VaultDefinition } from '@/db/schema';
import { VaultCreateDialog } from './vault-create-dialog';

interface SyncResult { imported: number; skipped: number; total: number; message?: string; }
interface SyncState  { [id: string]: 'idle' | 'syncing' | 'done' | 'error'; }

interface SemanticResult {
    title:      string;
    content:    string;
    relevance:  number;
    sourcePath: string;
    vaultId:    string;
    vaultLabel: string;
}

interface VaultBrowserProps {
    vaults:   VaultDefinition[];
    notes:    AuditItem[];
    userRole: string;
}

export function VaultBrowser({ vaults, notes, userRole }: VaultBrowserProps) {
    const [search,          setSearch]          = useState('');
    const [semanticResults, setSemanticResults] = useState<SemanticResult[] | null>(null);
    const [semanticLoading, setSemanticLoading] = useState(false);
    const [selectedNote,    setSelectedNote]    = useState<AuditItem | null>(null);
    const [selectedSemantic,setSelectedSemantic]= useState<SemanticResult | null>(null);
    const [expandedVault,   setExpandedVault]   = useState<string>(vaults[0]?.id ?? '');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [syncState,       setSyncState]       = useState<SyncState>({});
    const [syncResults,     setSyncResults]     = useState<Record<string, SyncResult>>({});
    const [localNotes,      setLocalNotes]      = useState<AuditItem[]>(notes);
    const [localVaults,     setLocalVaults]     = useState<VaultDefinition[]>(vaults);
    const [editingPath,     setEditingPath]     = useState<string | null>(null);
    const [pathDraft,       setPathDraft]       = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    const canSync   = userRole === 'admin' || userRole === 'technical';
    const canCreate = userRole === 'admin';

    // Text-filter on notes (used when no semantic results)
    const textFiltered = localNotes.filter(n =>
        !search ||
        n.generatedTitle.toLowerCase().includes(search.toLowerCase()) ||
        n.area?.toLowerCase().includes(search.toLowerCase()) ||
        n.sourceFileName?.toLowerCase().includes(search.toLowerCase()),
    );

    // Semantic search — triggered on Enter
    async function runSemanticSearch() {
        if (!search.trim() || search.trim().length < 3) return;
        setSemanticLoading(true);
        setSemanticResults(null);
        setSelectedSemantic(null);
        try {
            const res  = await fetch(`/api/search?q=${encodeURIComponent(search.trim())}`);
            const data = await res.json();
            setSemanticResults(res.ok ? (data.results as SemanticResult[]) : []);
        } catch {
            setSemanticResults([]);
        } finally {
            setSemanticLoading(false);
        }
    }

    function handleSearchKey(e: React.KeyboardEvent) {
        if (e.key === 'Enter')  { runSemanticSearch(); }
        if (e.key === 'Escape') { setSemanticResults(null); setSelectedSemantic(null); }
    }

    function clearSearch() {
        setSearch('');
        setSemanticResults(null);
        setSelectedSemantic(null);
    }

    // Group text-filtered notes by vault → area
    const byVault = Object.fromEntries(
        localVaults.map(v => {
            const vNotes = textFiltered.filter(n => n.vaultId === v.id);
            const byArea: Record<string, AuditItem[]> = {};
            for (const note of vNotes) {
                const area = note.area ?? 'general';
                (byArea[area] ??= []).push(note);
            }
            return [v.id, { notes: vNotes, byArea }];
        }),
    );

    function toggleFolder(key: string) {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }

    async function savePath(vaultId: string) {
        const res = await fetch(`/api/vaults/${vaultId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: pathDraft }),
        });
        if (res.ok) setLocalVaults(prev => prev.map(v => v.id === vaultId ? { ...v, path: pathDraft } : v));
        setEditingPath(null);
    }

    async function handleSync(vault: VaultDefinition) {
        setSyncState(s => ({ ...s, [vault.id]: 'syncing' }));
        setSyncResults(r => { const c = { ...r }; delete c[vault.id]; return c; });
        try {
            const res  = await fetch(`/api/vaults/${vault.id}/sync`, { method: 'POST' });
            const data: SyncResult = await res.json();
            if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Error');
            setSyncResults(r => ({ ...r, [vault.id]: data }));
            setSyncState(s => ({ ...s, [vault.id]: 'done' }));

            const notesRes = await fetch(`/api/vaults/${vault.id}/notes`);
            if (notesRes.ok) {
                const newNotes: AuditItem[] = await notesRes.json();
                setLocalNotes(prev => [...prev.filter(n => n.vaultId !== vault.id), ...newNotes]);
                const areas = [...new Set(newNotes.map(n => n.area ?? 'general'))];
                setExpandedFolders(prev => {
                    const next = new Set(prev);
                    areas.forEach(a => next.add(`${vault.id}:${a}`));
                    return next;
                });
            }
        } catch (err) {
            setSyncState(s => ({ ...s, [vault.id]: 'error' }));
            setSyncResults(r => ({ ...r, [vault.id]: { imported: 0, skipped: 0, total: 0, message: (err as Error).message } }));
        }
    }

    function handleVaultCreated(vault: VaultDefinition) {
        setLocalVaults(prev => [...prev, vault]);
        setExpandedVault(vault.id);
    }

    return (
        <div className="flex flex-1 min-h-0">
            {/* ── Left tree ── */}
            <div className="flex w-80 shrink-0 flex-col border-r border-border">
                <div className="p-3 border-b border-border space-y-2">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={searchRef}
                            placeholder="Filtrar… Enter = búsqueda semántica"
                            className="pl-9 pr-16 h-8 text-xs"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setSemanticResults(null); }}
                            onKeyDown={handleSearchKey}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            {semanticLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                            {search && !semanticLoading && (
                                <button onClick={clearSearch} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Semantic hint */}
                    {semanticResults !== null && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Sparkles className="h-3 w-3 text-primary/60" />
                            {semanticResults.length} resultado{semanticResults.length !== 1 ? 's' : ''} semántico{semanticResults.length !== 1 ? 's' : ''}
                            <button onClick={clearSearch} className="ml-auto text-muted-foreground hover:text-foreground">(limpiar)</button>
                        </div>
                    )}
                </div>

                {/* Semantic results list */}
                {semanticResults !== null ? (
                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                        {semanticResults.length === 0 && (
                            <p className="px-3 py-4 text-xs text-muted-foreground">Sin resultados semánticos.</p>
                        )}
                        {semanticResults.map((r, i) => (
                            <button
                                key={i}
                                onClick={() => { setSelectedSemantic(r); setSelectedNote(null); }}
                                className={cn(
                                    'w-full text-left rounded-lg px-3 py-2 transition-colors',
                                    selectedSemantic === r
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className="text-xs font-medium truncate">{r.title}</span>
                                    <span className="shrink-0 text-[10px] text-emerald-400 font-mono">
                                        {Math.round(r.relevance * 100)}%
                                    </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground/70">{r.vaultLabel}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    /* Normal vault tree */
                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                        {/* Header row with + button */}
                        <div className="flex items-center justify-between px-2 py-1 mb-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Vaults</span>
                            {canCreate && <VaultCreateDialog onCreated={handleVaultCreated} />}
                        </div>

                        {localVaults.map(vault => {
                            const { notes: vNotes, byArea } = byVault[vault.id] ?? { notes: [], byArea: {} };
                            const expanded = expandedVault === vault.id;
                            const syncing  = syncState[vault.id] === 'syncing';
                            const result   = syncResults[vault.id];
                            const folders  = Object.keys(byArea).sort();

                            return (
                                <div key={vault.id}>
                                    {/* Vault row */}
                                    <div className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-accent/30 transition-colors">
                                        <button
                                            className="flex flex-1 items-center gap-2 px-2 py-2 text-xs font-semibold text-foreground"
                                            onClick={() => setExpandedVault(expanded ? '' : vault.id)}
                                        >
                                            {expanded
                                                ? <ChevronDown  className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            }
                                            <Database className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                                            <span className="flex-1 text-left">{vault.label}</span>
                                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                                                {vNotes.length}
                                            </span>
                                        </button>

                                        {canSync && (
                                            <>
                                                {userRole === 'admin' && (
                                                    <button
                                                        onClick={() => { setEditingPath(vault.id); setPathDraft(vault.path ?? ''); }}
                                                        title="Editar path"
                                                        className="rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                                                    >
                                                        <Settings2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleSync(vault)}
                                                    disabled={syncing}
                                                    title="Sincronizar desde disco"
                                                    className={cn(
                                                        'rounded p-1 transition-all',
                                                        syncing ? 'text-primary' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent',
                                                    )}
                                                >
                                                    <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* Inline path editor */}
                                    {editingPath === vault.id && (
                                        <div className="mx-2 mb-1 flex items-center gap-1">
                                            <input
                                                autoFocus
                                                value={pathDraft}
                                                onChange={e => setPathDraft(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') savePath(vault.id); if (e.key === 'Escape') setEditingPath(null); }}
                                                placeholder="Ruta absoluta del vault..."
                                                className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-mono text-foreground outline-none focus:border-primary"
                                            />
                                            <button onClick={() => savePath(vault.id)} className="rounded p-1 text-emerald-400 hover:bg-emerald-950/30">
                                                <Check className="h-3.5 w-3.5" />
                                            </button>
                                            <button onClick={() => setEditingPath(null)} className="rounded p-1 text-muted-foreground hover:bg-accent">
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Sync result */}
                                    {result && (
                                        <div className={cn(
                                            'mx-2 mb-1 rounded-md px-2 py-1 text-[10px]',
                                            syncState[vault.id] === 'error'
                                                ? 'bg-red-950/30 text-red-400'
                                                : 'bg-emerald-950/30 text-emerald-400',
                                        )}>
                                            {syncState[vault.id] === 'error'
                                                ? `Error: ${result.message}`
                                                : result.message ?? `+${result.imported} importadas · ${result.skipped} ya existían · ${result.total} total`
                                            }
                                        </div>
                                    )}

                                    {/* Folders */}
                                    {expanded && (
                                        <div className="ml-2 mt-0.5 space-y-0.5">
                                            {vNotes.length === 0 && !syncing && (
                                                <p className="px-4 py-2 text-xs text-muted-foreground">
                                                    Sin notas.{canSync && ' Usá ↻ para sincronizar.'}
                                                </p>
                                            )}
                                            {syncing && (
                                                <p className="px-4 py-2 text-xs text-muted-foreground animate-pulse">Importando...</p>
                                            )}
                                            {folders.map(area => {
                                                const folderKey   = `${vault.id}:${area}`;
                                                const folderOpen  = expandedFolders.has(folderKey);
                                                const folderNotes = byArea[area] ?? [];

                                                return (
                                                    <div key={area}>
                                                        <button
                                                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
                                                            onClick={() => toggleFolder(folderKey)}
                                                        >
                                                            {folderOpen
                                                                ? <ChevronDown className="h-3 w-3 shrink-0" />
                                                                : <ChevronRight className="h-3 w-3 shrink-0" />
                                                            }
                                                            {folderOpen
                                                                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                                                                : <Folder     className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                                                            }
                                                            <span className="flex-1 text-left">{area}</span>
                                                            <span className="text-[10px] text-muted-foreground/60">{folderNotes.length}</span>
                                                        </button>

                                                        {folderOpen && (
                                                            <div className="ml-5 space-y-0.5">
                                                                {folderNotes.map(note => (
                                                                    <button
                                                                        key={note.id}
                                                                        onClick={() => { setSelectedNote(note); setSelectedSemantic(null); }}
                                                                        className={cn(
                                                                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                                                            selectedNote?.id === note.id
                                                                                ? 'bg-primary/10 text-primary'
                                                                                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                                                                        )}
                                                                    >
                                                                        <FileText className="h-3 w-3 shrink-0" />
                                                                        <span className="truncate">{note.generatedTitle}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Right preview ── */}
            <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
                {selectedSemantic ? (
                    <SemanticPreview result={selectedSemantic} />
                ) : selectedNote ? (
                    <NotePreview note={selectedNote} vault={localVaults.find(v => v.id === selectedNote.vaultId)} />
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-8">
                        <Database className="h-12 w-12 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">Seleccioná una nota para previsualizarla</p>
                        <p className="text-xs text-muted-foreground/60">
                            {semanticResults !== null
                                ? `${semanticResults.length} resultados semánticos`
                                : `${textFiltered.length} notas disponibles · Enter en búsqueda para semántica`
                            }
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Note preview ──────────────────────────────────────────────────────────────

function NotePreview({ note, vault }: { note: AuditItem; vault?: VaultDefinition }) {
    const tags: string[] = JSON.parse(note.tags ?? '[]');

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-semibold">{note.generatedTitle}</h2>
                    <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(note.createdAt!).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {vault && (
                        <Badge variant="outline" className="text-xs gap-1">
                            <Database className="h-3 w-3" />{vault.label}
                        </Badge>
                    )}
                    {note.area && (
                        <Badge variant="secondary" className="text-xs gap-1">
                            <Folder className="h-3 w-3" />{note.area}
                        </Badge>
                    )}
                    {tags.map(tag => (
                        <div key={tag} className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-0.5">
                            <Tag className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">{tag}</span>
                        </div>
                    ))}
                    {note.curatorScore != null && (
                        <span className="text-xs text-muted-foreground">
                            Score: <span className="font-medium text-emerald-400">{Math.round(note.curatorScore * 100)}%</span>
                        </span>
                    )}
                </div>
                <p className="text-[11px] font-mono text-muted-foreground/60">{note.sourceFileName}</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-5">
                <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {note.generatedContent}
                </pre>
            </div>
        </div>
    );
}

// ── Semantic result preview ───────────────────────────────────────────────────

function SemanticPreview({ result }: { result: SemanticResult }) {
    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-semibold">{result.title}</h2>
                    <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 shrink-0">
                        <Sparkles className="h-3 w-3" />
                        {Math.round(result.relevance * 100)}% relevancia
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs gap-1">
                        <Database className="h-3 w-3" />{result.vaultLabel}
                    </Badge>
                    <span className="text-[11px] font-mono text-muted-foreground/60 truncate">
                        {result.sourcePath.split(/[\\/]/).pop()}
                    </span>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-5">
                <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {result.content}
                </pre>
            </div>
        </div>
    );
}
