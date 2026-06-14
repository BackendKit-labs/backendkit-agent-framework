'use client';
import { CheckCircle2, XCircle, Clock, Sparkles, Upload } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@/components/ui';
import type { AuditItem } from '@/db/schema';

const STATUS_CONFIG = {
    approved:   { icon: CheckCircle2, color: 'text-emerald-400', label: 'Aprobado' },
    rejected:   { icon: XCircle,      color: 'text-red-400',     label: 'Rechazado' },
    pending:    { icon: Clock,         color: 'text-amber-400',   label: 'Pendiente' },
    improved:   { icon: Sparkles,      color: 'text-indigo-400',  label: 'Mejorado' },
    processing: { icon: Upload,        color: 'text-blue-400',    label: 'Procesando' },
};

interface RecentActivityProps {
    items: AuditItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
    return (
        <Card className="border-border/50">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Actividad Reciente</CardTitle>
            </CardHeader>
            <CardContent>
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                        <Clock className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No hay actividad aún.</p>
                        <p className="text-xs text-muted-foreground">Comenzá ingiriendo documentos.</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {items.map((item, i) => {
                            const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
                            const Icon = cfg.icon;
                            return (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent/30"
                                    style={{ animationDelay: `${i * 40}ms` }}
                                >
                                    <Icon className={cn('h-4 w-4 shrink-0', cfg.color)} />
                                    <div className="flex flex-1 flex-col min-w-0">
                                        <span className="truncate text-sm">{item.generatedTitle}</span>
                                        <span className="text-xs text-muted-foreground">{item.area ?? 'general'}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(item.createdAt!).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
