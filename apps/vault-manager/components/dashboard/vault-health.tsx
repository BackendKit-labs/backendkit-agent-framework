'use client';
import { Database, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@/components/ui';

interface VaultStats {
    id:          string;
    label:       string;
    ownerRole:   string;
    totalNotes:  number;
    approved:    number;
    pending:     number;
}

interface VaultHealthProps {
    vaults: VaultStats[];
}

const ROLE_COLORS: Record<string, string> = {
    technical: 'text-blue-400 bg-blue-950/50 border-blue-800',
    business:  'text-purple-400 bg-purple-950/50 border-purple-800',
    admin:     'text-rose-400 bg-rose-950/50 border-rose-800',
};

export function VaultHealth({ vaults }: VaultHealthProps) {
    return (
        <Card className="border-border/50">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Estado de Vaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {vaults.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                        No hay vaults configurados aún.
                    </p>
                )}
                {vaults.map((vault) => {
                    const pct = vault.totalNotes > 0 ? Math.round((vault.approved / vault.totalNotes) * 100) : 0;
                    return (
                        <div key={vault.id} className="group flex items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-accent/30">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Database className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-medium">{vault.label}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge className={cn('text-[10px] border', ROLE_COLORS[vault.ownerRole] ?? 'text-zinc-400')}>
                                            {vault.ownerRole}
                                        </Badge>
                                        <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                                    </div>
                                </div>
                                {/* Progress bar */}
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                        className={cn('h-full rounded-full transition-all', pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                    <span>{vault.totalNotes} notas</span>
                                    <span className="text-emerald-400">{vault.approved} aprobadas</span>
                                    {vault.pending > 0 && <span className="text-amber-400">{vault.pending} pendientes</span>}
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
