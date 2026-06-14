'use client';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';

interface DayData {
    date:      string;
    ingestas:  number;
    aprobadas: number;
    mejoradas: number;
}

interface ActivityChartProps {
    data: DayData[];
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
            {payload.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
                    <span className="text-muted-foreground capitalize">{entry.name}:</span>
                    <span className="font-medium">{entry.value}</span>
                </div>
            ))}
        </div>
    );
};

export function ActivityChart({ data }: ActivityChartProps) {
    return (
        <Card className="border-border/50">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Actividad — últimos 14 días</CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorIngestas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorAprobadas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorMejoradas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 17%)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }}
                        />
                        <Area type="monotone" dataKey="ingestas"  stroke="#6366f1" fill="url(#colorIngestas)"  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                        <Area type="monotone" dataKey="aprobadas" stroke="#10b981" fill="url(#colorAprobadas)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                        <Area type="monotone" dataKey="mejoradas" stroke="#f59e0b" fill="url(#colorMejoradas)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
