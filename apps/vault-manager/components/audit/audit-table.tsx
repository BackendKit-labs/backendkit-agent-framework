'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
    ChevronRight, Filter, Search, SortAsc,
    CheckCircle2, XCircle, Clock, Sparkles,
    FileText, RefreshCw,
} from 'lucide-react';
import { Button, Badge, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, cn } from '@/components/ui';
import { AUDIT_STATUS_COLORS, AUDIT_STATUS_LABELS } from '@/lib/permissions';
import type { AuditItem, VaultDefinition } from '@/db/schema';

interface AuditTableProps {
    items:  AuditItem[];
    vaults: VaultDefinition[];
    onRefresh?: () => void;
}

const STATUS_ICONS: Record<string, React.ElementType> = {
    pending:    Clock,
    approved:   CheckCircle2,
    rejected:   XCircle,
    improved:   Sparkles,
    processing: RefreshCw,
};

export function AuditTable({ items, vaults, onRefresh }: AuditTableProps) {
    const [search,       setSearch]       = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [vaultFilter,  setVaultFilter]  = useState<string>('all');

    const vaultMap = Object.fromEntries(vaults.map(v => [v.id, v]));

    const filtered = items.filter(item => {
        const matchSearch = !search ||
            item.generatedTitle.toLowerCase().includes(search.toLowerCase()) ||
            item.sourceFileName.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || item.status === statusFilter;
        const matchVault  = vaultFilter  === 'all' || item.vaultId === vaultFilter;
        return matchSearch && matchStatus && matchVault;
    });

    return (
        <div className="flex flex-col gap-4">
            {/* Filters */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por título o archivo..."
                        className="pl-9 h-8 text-xs"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                        <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="pending">Pendiente</SelectItem>
                        <SelectItem value="approved">Aprobado</SelectItem>
                        <SelectItem value="rejected">Rechazado</SelectItem>
                        <SelectItem value="improved">Mejorado</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={vaultFilter} onValueChange={setVaultFilter}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                        <SelectValue placeholder="Vault" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los vaults</SelectItem>
                        {vaults.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                    </span>
                    {onRefresh && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
                            <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border bg-muted/30">
                            {['Nota generada', 'Vault', 'Área', 'Score', 'Estado', 'Fecha', ''].map(h => (
                                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                                    No hay elementos que coincidan con los filtros.
                                </td>
                            </tr>
                        )}
                        {filtered.map((item, i) => {
                            const StatusIcon = STATUS_ICONS[item.status] ?? Clock;
                            const vault = vaultMap[item.vaultId];
                            return (
                                <tr
                                    key={item.id}
                                    className={cn(
                                        'group border-b border-border/50 transition-colors hover:bg-accent/20',
                                        i % 2 === 0 ? 'bg-background/40' : 'bg-background/20',
                                    )}
                                >
                                    {/* Title */}
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="truncate text-sm font-medium max-w-[220px]">
                                                    {item.generatedTitle}
                                                </span>
                                                <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                                                    {item.sourceFileName}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    {/* Vault */}
                                    <td className="px-4 py-3">
                                        <span className="text-xs text-muted-foreground">
                                            {vault?.label ?? item.vaultId}
                                        </span>
                                    </td>
                                    {/* Area */}
                                    <td className="px-4 py-3">
                                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                            {item.area ?? 'general'}
                                        </span>
                                    </td>
                                    {/* Score */}
                                    <td className="px-4 py-3">
                                        {item.curatorScore != null ? (
                                            <div className="flex items-center gap-2">
                                                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                                                    <div
                                                        className={cn(
                                                            'h-full rounded-full',
                                                            item.curatorScore >= 0.8 ? 'bg-emerald-500' :
                                                            item.curatorScore >= 0.5 ? 'bg-amber-500' : 'bg-red-500',
                                                        )}
                                                        style={{ width: `${item.curatorScore * 100}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs tabular-nums text-muted-foreground">
                                                    {Math.round(item.curatorScore * 100)}%
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                    {/* Status */}
                                    <td className="px-4 py-3">
                                        <Badge className={cn('gap-1 border text-xs', AUDIT_STATUS_COLORS[item.status])}>
                                            <StatusIcon className="h-3 w-3" />
                                            {AUDIT_STATUS_LABELS[item.status]}
                                        </Badge>
                                    </td>
                                    {/* Date */}
                                    <td className="px-4 py-3">
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(item.createdAt!).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })}
                                        </span>
                                    </td>
                                    {/* Action */}
                                    <td className="px-4 py-3">
                                        <Link href={`/audit/${item.id}`}>
                                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs opacity-0 group-hover:opacity-100">
                                                Revisar
                                                <ChevronRight className="h-3 w-3" />
                                            </Button>
                                        </Link>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
