'use client';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button, Progress, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, cn } from '@/components/ui';
import type { VaultDefinition } from '@/db/schema';

interface UploadFile {
    file:     File;
    status:   'queued' | 'uploading' | 'processing' | 'done' | 'failed';
    progress: number;
    error?:   string;
    jobId?:   string;
}

interface UploadZoneProps {
    vaults:    VaultDefinition[];
    userRole:  string;
}

const AREA_OPTIONS = [
    { value: 'general',      label: 'General' },
    { value: 'ml',           label: 'Machine Learning' },
    { value: 'arquitectura', label: 'Arquitectura' },
    { value: 'procesos',     label: 'Procesos' },
    { value: 'compliance',   label: 'Compliance' },
    { value: 'operaciones',  label: 'Operaciones' },
];

const STATUS_ICON = {
    queued:     <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground" />,
    uploading:  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
    processing: <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />,
    done:       <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    failed:     <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
};

export function UploadZone({ vaults, userRole }: UploadZoneProps) {
    const [files,       setFiles]       = useState<UploadFile[]>([]);
    const [vaultId,     setVaultId]     = useState('');
    const [areaHint,    setAreaHint]    = useState('general');
    const [submitting,  setSubmitting]  = useState(false);

    const allowedVaults = vaults.filter(v =>
        userRole === 'admin' || v.ownerRole === userRole,
    );

    const onDrop = useCallback((accepted: File[]) => {
        const newFiles = accepted.map(f => ({
            file: f, status: 'queued' as const, progress: 0,
        }));
        setFiles(prev => [...prev, ...newFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'text/markdown': ['.md'], 'text/plain': ['.txt'], 'application/pdf': ['.pdf'] },
        multiple: true,
    });

    function removeFile(idx: number) {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    }

    async function startIngest() {
        if (!vaultId || files.length === 0) return;
        setSubmitting(true);

        for (let i = 0; i < files.length; i++) {
            if (files[i].status !== 'queued') continue;

            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'uploading', progress: 10 } : f));

            const form = new FormData();
            form.append('file',     files[i].file);
            form.append('vaultId',  vaultId);
            form.append('areaHint', areaHint);

            try {
                const res  = await fetch('/api/ingest', { method: 'POST', body: form });
                const data = await res.json();

                if (res.ok) {
                    setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing', progress: 60, jobId: data.jobId } : f));
                    // Poll until done
                    await pollJob(data.jobId, i);
                } else {
                    setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'failed', error: data.error } : f));
                }
            } catch {
                setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'failed', error: 'Error de red' } : f));
            }
        }
        setSubmitting(false);
    }

    async function pollJob(jobId: string, fileIdx: number) {
        for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            const res  = await fetch(`/api/ingest?jobId=${jobId}`);
            const data = await res.json();
            if (data.status === 'done') {
                setFiles(prev => prev.map((f, i) => i === fileIdx ? { ...f, status: 'done', progress: 100 } : f));
                return;
            }
            if (data.status === 'failed') {
                setFiles(prev => prev.map((f, i) => i === fileIdx ? { ...f, status: 'failed', error: data.error } : f));
                return;
            }
            const pct = Math.min(60 + attempt * 2, 90);
            setFiles(prev => prev.map((f, i) => i === fileIdx ? { ...f, progress: pct } : f));
        }
    }

    const canSubmit = vaultId && files.some(f => f.status === 'queued') && !submitting;

    return (
        <div className="space-y-6">
            {/* Config row */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Vault destino *</label>
                    <Select value={vaultId} onValueChange={setVaultId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seleccioná un vault..." />
                        </SelectTrigger>
                        <SelectContent>
                            {allowedVaults.map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                    <div className="flex flex-col">
                                        <span>{v.label}</span>
                                        <span className="text-xs text-muted-foreground">{v.description}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {allowedVaults.length === 0 && (
                        <p className="text-xs text-amber-400">No tenés acceso a ningún vault con tu rol actual.</p>
                    )}
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Área de conocimiento</label>
                    <Select value={areaHint} onValueChange={setAreaHint}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {AREA_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Drop zone */}
            <div
                {...getRootProps()}
                className={cn(
                    'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition-all cursor-pointer',
                    isDragActive
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border bg-muted/20 hover:border-input hover:bg-muted/40',
                )}
            >
                <input {...getInputProps()} />
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                    <Upload className={cn('h-6 w-6', isDragActive ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <div>
                    <p className="text-sm font-medium">
                        {isDragActive ? 'Soltá los archivos acá' : 'Arrastrá archivos o hacé click'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Soporta .md, .txt, .pdf · El curator AI los procesará automáticamente
                    </p>
                </div>
            </div>

            {/* File queue */}
            {files.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                    <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs font-medium">{files.length} archivo{files.length !== 1 ? 's' : ''}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => setFiles(f => f.filter(x => x.status !== 'queued'))}
                        >
                            Limpiar cola
                        </Button>
                    </div>
                    <div className="divide-y divide-border/50">
                        {files.map((f, i) => (
                            <div key={i} className="flex items-center gap-3 px-4 py-3">
                                {STATUS_ICON[f.status]}
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="flex flex-1 flex-col gap-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm">{f.file.name}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {(f.file.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                    {(f.status === 'uploading' || f.status === 'processing') && (
                                        <Progress value={f.progress} className="h-1" />
                                    )}
                                    {f.error && <p className="text-xs text-red-400">{f.error}</p>}
                                </div>
                                {f.status === 'queued' && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFile(i)}>
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                    Los archivos procesados irán a la cola de auditoría para revisión humana.
                </p>
                <Button onClick={startIngest} disabled={!canSubmit} className="gap-2">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'Procesando...' : `Iniciar ingesta${files.filter(f => f.status === 'queued').length > 0 ? ` (${files.filter(f => f.status === 'queued').length})` : ''}`}
                </Button>
            </div>
        </div>
    );
}
