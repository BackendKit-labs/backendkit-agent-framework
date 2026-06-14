'use client';
import { useState } from 'react';
import { Plus, FolderSearch, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/components/ui';
import type { VaultDefinition } from '@/db/schema';

type OwnerRole = 'admin' | 'technical' | 'business';
type Tab       = 'create' | 'import';
type Status    = 'idle' | 'scanning' | 'saving' | 'done' | 'error';

const ROLE_LABELS: Record<OwnerRole, string> = {
    admin:     'Administrador',
    technical: 'Técnico',
    business:  'Negocio',
};

interface VaultCreateDialogProps {
    onCreated: (vault: VaultDefinition) => void;
}

export function VaultCreateDialog({ onCreated }: VaultCreateDialogProps) {
    const [open,        setOpen]        = useState(false);
    const [tab,         setTab]         = useState<Tab>('create');
    const [status,      setStatus]      = useState<Status>('idle');
    const [errorMsg,    setErrorMsg]    = useState('');
    const [scanCount,   setScanCount]   = useState<number | null>(null);
    const [label,       setLabel]       = useState('');
    const [path,        setPath]        = useState('');
    const [role,        setRole]        = useState<OwnerRole>('technical');
    const [description, setDescription] = useState('');

    const busy = status === 'scanning' || status === 'saving';

    function reset() {
        setStatus('idle'); setErrorMsg(''); setScanCount(null);
        setLabel(''); setPath(''); setRole('technical'); setDescription(''); setTab('create');
    }

    function close() { if (!busy) { reset(); setOpen(false); } }

    async function handleCreate() {
        if (!label.trim() || !path.trim()) { setErrorMsg('Label y path son requeridos.'); return; }
        setStatus('saving'); setErrorMsg('');
        try {
            const res  = await fetch('/api/vaults', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ label: label.trim(), path: path.trim(), ownerRole: role, description: description.trim() || undefined }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? 'Error al crear vault');
            setStatus('done');
            onCreated(data.vault as VaultDefinition);
            setTimeout(() => { setOpen(false); reset(); }, 1200);
        } catch (err) { setErrorMsg((err as Error).message); setStatus('error'); }
    }

    async function handleImport() {
        if (!path.trim()) { setErrorMsg('El path es requerido.'); return; }

        // Step 1: scan directory
        if (scanCount === null) {
            setStatus('scanning'); setErrorMsg('');
            try {
                const res  = await fetch(`/api/vaults/scan?path=${encodeURIComponent(path.trim())}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? 'Error al escanear directorio');
                setScanCount(data.count as number);
                setStatus('idle');
            } catch (err) { setErrorMsg((err as Error).message); setStatus('error'); }
            return;
        }

        // Step 2: create + sync
        if (!label.trim()) { setErrorMsg('El label es requerido.'); return; }
        setStatus('saving'); setErrorMsg('');
        try {
            const res  = await fetch('/api/vaults', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ label: label.trim(), path: path.trim(), ownerRole: role, description: description.trim() || undefined }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? 'Error al crear vault');
            const vault = data.vault as VaultDefinition;
            // Sync in background
            fetch(`/api/vaults/${vault.id}/sync`, { method: 'POST' }).catch(console.warn);
            setStatus('done');
            onCreated(vault);
            setTimeout(() => { setOpen(false); reset(); }, 1200);
        } catch (err) { setErrorMsg((err as Error).message); setStatus('error'); }
    }

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                title="Crear o importar vault"
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
                <Plus className="h-3.5 w-3.5" />
            </button>

            {open && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/50 z-40"
                        onClick={close}
                    />

                    {/* Dialog */}
                    <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-sm font-semibold">
                                {tab === 'create' ? 'Nuevo Vault' : 'Importar Vault existente'}
                            </h2>
                            <button
                                onClick={close}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex mb-5 rounded-lg bg-muted/40 p-0.5 gap-0.5">
                            {(['create', 'import'] as Tab[]).map(t => (
                                <button
                                    key={t}
                                    onClick={() => { setTab(t); setScanCount(null); setErrorMsg(''); }}
                                    className={cn(
                                        'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                                        tab === t
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {t === 'create' ? 'Crear nuevo' : 'Importar existente'}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3">
                            {/* Path */}
                            <div>
                                <label className="mb-1 block text-xs text-muted-foreground">
                                    {tab === 'create' ? 'Ruta del vault (se creará si no existe)' : 'Ruta del directorio existente'}
                                </label>
                                <input
                                    value={path}
                                    onChange={e => { setPath(e.target.value); setScanCount(null); }}
                                    placeholder="C:/mis-vaults/nombre  o  ./vaults/nombre"
                                    className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary transition-colors"
                                />
                            </div>

                            {/* Scan preview */}
                            {tab === 'import' && scanCount !== null && (
                                <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-900/40 px-3 py-2 text-xs text-emerald-400">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    {scanCount} archivos .md encontrados — listo para importar
                                </div>
                            )}

                            {/* Label, role, description — show after scan or always for create */}
                            {(tab === 'create' || scanCount !== null) && (
                                <>
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Nombre del vault</label>
                                        <input
                                            value={label}
                                            onChange={e => setLabel(e.target.value)}
                                            placeholder="Ej: AI Engineering, Procesos, Empresa"
                                            className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary transition-colors"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Acceso</label>
                                        <div className="flex gap-2">
                                            {(Object.keys(ROLE_LABELS) as OwnerRole[]).map(r => (
                                                <button
                                                    key={r}
                                                    onClick={() => setRole(r)}
                                                    className={cn(
                                                        'flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors',
                                                        role === r
                                                            ? 'border-primary bg-primary/10 text-primary'
                                                            : 'border-border bg-muted/20 text-muted-foreground hover:border-border/60 hover:text-foreground',
                                                    )}
                                                >
                                                    {ROLE_LABELS[r]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Descripción (opcional)</label>
                                        <input
                                            value={description}
                                            onChange={e => setDescription(e.target.value)}
                                            placeholder="Propósito del vault..."
                                            className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary transition-colors"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Error / Success */}
                            {errorMsg && (
                                <div className="flex items-center gap-2 rounded-lg bg-red-950/30 border border-red-900/40 px-3 py-2 text-xs text-red-400">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorMsg}
                                </div>
                            )}
                            {status === 'done' && (
                                <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-900/40 px-3 py-2 text-xs text-emerald-400">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Vault creado correctamente
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="mt-5 flex gap-2 justify-end">
                            <button
                                onClick={close}
                                className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={tab === 'create' ? handleCreate : handleImport}
                                disabled={busy || status === 'done'}
                                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                                {tab === 'create'
                                    ? 'Crear vault'
                                    : scanCount === null
                                    ? (<><FolderSearch className="h-3 w-3" />Escanear</>)
                                    : 'Importar vault'
                                }
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
