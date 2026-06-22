'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from 'lucide-react';
import { cn, roleBg } from '@/lib/utils';

interface TopbarProps {
    title:     string;
    subtitle?: string;
}

function decodeJwt(token: string): { sub?: string; role?: string } | null {
    try { return JSON.parse(atob(token.split('.')[1])); }
    catch { return null; }
}

export function Topbar({ title, subtitle }: TopbarProps) {
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [role,     setRole]     = useState('');

    useEffect(() => {
        const token = sessionStorage.getItem('auth_token');
        if (!token) return;
        const payload = decodeJwt(token);
        if (payload) { setUsername(payload.sub ?? ''); setRole(payload.role ?? ''); }
    }, []);

    function logout() { sessionStorage.clear(); router.push('/login'); }

    return (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
            <div className="flex flex-col leading-none">
                <h1 className="text-sm font-semibold text-foreground">{title}</h1>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={logout}
                    className={cn(
                        'flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs',
                        'transition-colors hover:bg-accent cursor-pointer',
                    )}
                >
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                        <User className="h-3 w-3 text-primary" />
                    </div>
                    <span className="max-w-[120px] truncate text-muted-foreground">{username || '—'}</span>
                    {role && (
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', roleBg(role))}>
                            {role}
                        </span>
                    )}
                </button>
            </div>
        </header>
    );
}
