'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    CheckCircle2, XCircle, Sparkles, ArrowLeft,
    Loader2, MessageSquare, FileText, Tag,
} from 'lucide-react';
import { Button, Badge, Textarea, cn } from '@/components/ui';
import { DiffViewer } from '@/components/audit/diff-viewer';
import { AUDIT_STATUS_COLORS, AUDIT_STATUS_LABELS } from '@/lib/permissions';
import type { AuditItem, VaultDefinition } from '@/db/schema';

export default function AuditDetailPage() {
    const { id }  = useParams<{ id: string }>();
    const router  = useRouter();

    const [item,     setItem]     = useState<AuditItem | null>(null);
    const [vault,    setVault]    = useState<VaultDefinition | null>(null);
    const [loading,  setLoading]  = useState(true);
    const [feedback, setFeedback] = useState('');
    const [acting,   setActing]   = useState(false);

    useEffect(() => {
        fetch(`/api/notes/${id}`)
            .then(r => r.json())
            .then(({ item: i, vault: v }) => { setItem(i); setVault(v); })
            .finally(() => setLoading(false));
    }, [id]);

    async function act(action: 'approve' | 'reject' | 'improve') {
        setActing(true);
        await fetch(`/api/notes/${id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action, feedback }),
        });
        setActing(false);
        if (action === 'improve') router.push(`/improve?auditId=${id}`);
        else router.push('/audit');
    }

    async function saveEdit(content: string) {
        await fetch(`/api/notes/${id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'edit', content }),
        });
    }

    if (loading) return (
        <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    );

    if (!item) return (
        <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground">Elemento no encontrado.</p>
        </div>
    );

    const tags: string[] = JSON.parse(item.tags ?? '[]');

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-6">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex flex-1 items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <h1 className="truncate text-sm font-semibold">{item.generatedTitle}</h1>
                    <Badge className={cn('shrink-0 border text-xs', AUDIT_STATUS_COLORS[item.status])}>
                        {AUDIT_STATUS_LABELS[item.status]}
                    </Badge>
                </div>
                {/* Metadata chips */}
                <div className="flex items-center gap-2 shrink-0">
                    {vault && <span className="text-xs text-muted-foreground">{vault.label}</span>}
                    {item.area && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {item.area}
                        </span>
                    )}
                    {tags.map(tag => (
                        <div key={tag} className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-0.5">
                            <Tag className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">{tag}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main content — diff viewer */}
            <div className="flex flex-1 min-h-0 gap-4 p-6">
                <div className="flex flex-1 flex-col min-h-0">
                    <DiffViewer
                        sourceText={item.sourceText}
                        generatedContent={item.generatedContent}
                        generatedTitle={item.generatedTitle}
                        onEdit={saveEdit}
                    />
                </div>

                {/* Action panel */}
                <div className="flex w-72 shrink-0 flex-col gap-4">
                    {/* Feedback */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Feedback</span>
                            <span className="text-[10px] text-muted-foreground">(opcional)</span>
                        </div>
                        <Textarea
                            placeholder="Indicá por qué aprobás, rechazás, o qué querés mejorar..."
                            className="text-xs min-h-[100px]"
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                        />
                    </div>

                    {/* Actions */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground mb-3">Acciones</p>

                        <Button
                            className="w-full justify-start gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                            disabled={acting || item.status === 'approved'}
                            onClick={() => act('approve')}
                        >
                            {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Aprobar nota
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full justify-start gap-2 border-indigo-800 text-indigo-400 hover:bg-indigo-950/50"
                            disabled={acting}
                            onClick={() => act('improve')}
                        >
                            <Sparkles className="h-4 w-4" />
                            Mejorar con AI
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full justify-start gap-2 border-red-800 text-red-400 hover:bg-red-950/50"
                            disabled={acting || item.status === 'rejected'}
                            onClick={() => act('reject')}
                        >
                            <XCircle className="h-4 w-4" />
                            Rechazar
                        </Button>
                    </div>

                    {/* Metadata card */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Metadatos</p>
                        {[
                            { label: 'Archivo fuente', value: item.sourceFileName },
                            { label: 'Vault',          value: vault?.label ?? item.vaultId },
                            { label: 'Área',           value: item.area ?? 'general' },
                            { label: 'Score curator',  value: item.curatorScore != null ? `${Math.round(item.curatorScore * 100)}%` : '—' },
                            { label: 'Creado',         value: new Date(item.createdAt!).toLocaleDateString('es') },
                        ].map(row => (
                            <div key={row.label} className="flex items-start justify-between gap-2">
                                <span className="text-xs text-muted-foreground shrink-0">{row.label}</span>
                                <span className="text-xs font-medium text-right break-all">{row.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
