'use client';
import { TrendingUp, TrendingDown, FileText, ClipboardCheck, CheckCircle2, Database } from 'lucide-react';
import { Card, CardContent, cn } from '@/components/ui';

interface Stat {
    label:   string;
    value:   number | string;
    change?: number;
    icon:    React.ElementType;
    color:   string;
    detail?: string;
}

interface StatsCardsProps {
    totalNotes:    number;
    pendingAudit:  number;
    approvedWeek:  number;
    activeVaults:  number;
}

export function StatsCards({ totalNotes, pendingAudit, approvedWeek, activeVaults }: StatsCardsProps) {
    const stats: Stat[] = [
        {
            label:  'Notas en vault',
            value:  totalNotes,
            change: 12,
            icon:   FileText,
            color:  'text-blue-400',
            detail: 'total indexadas',
        },
        {
            label:  'Pendientes auditoría',
            value:  pendingAudit,
            icon:   ClipboardCheck,
            color:  pendingAudit > 0 ? 'text-amber-400' : 'text-emerald-400',
            detail: pendingAudit > 0 ? 'requieren revisión' : 'todo revisado',
        },
        {
            label:  'Aprobadas (7 días)',
            value:  approvedWeek,
            change: 8,
            icon:   CheckCircle2,
            color:  'text-emerald-400',
            detail: 'notas al vault',
        },
        {
            label:  'Vaults activos',
            value:  activeVaults,
            icon:   Database,
            color:  'text-indigo-400',
            detail: 'bases de conocimiento',
        },
    ];

    return (
        <div className="grid grid-cols-4 gap-4">
            {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                    <Card key={stat.label} className="animate-fade-in border-border/50">
                        <CardContent className="p-5">
                            <div className="flex items-start justify-between">
                                <div className="flex flex-col gap-1">
                                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                                    <p className="text-3xl font-bold tabular-nums">{stat.value}</p>
                                    <p className="text-xs text-muted-foreground">{stat.detail}</p>
                                </div>
                                <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-current/10', stat.color)}>
                                    <Icon className={cn('h-5 w-5', stat.color)} />
                                </div>
                            </div>
                            {stat.change !== undefined && (
                                <div className="mt-3 flex items-center gap-1.5">
                                    {stat.change >= 0
                                        ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                                        : <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                                    }
                                    <span className={cn('text-xs font-medium', stat.change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                        {stat.change >= 0 ? '+' : ''}{stat.change}%
                                    </span>
                                    <span className="text-xs text-muted-foreground">vs semana anterior</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
