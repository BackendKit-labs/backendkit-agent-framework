'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, User } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
            {/* Title */}
            <div className="flex flex-col leading-none">
                <h1 className="text-sm font-semibold text-foreground">{title}</h1>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>

            {/* Right */}
            <div className="flex items-center gap-2">
                {/* Notifications */}
                <button className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <Bell className="h-4 w-4" />
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                </button>

                {/* User dropdown */}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <button className="flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:bg-accent">
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
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            align="end"
                            sideOffset={6}
                            className="z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
                        >
                            <div className="px-2 py-1.5">
                                <p className="text-sm font-medium">{username}</p>
                                {role && <p className="text-xs text-muted-foreground">{role}</p>}
                            </div>
                            <DropdownMenu.Separator className="my-1 h-px bg-border" />
                            <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive"
                                onSelect={logout}
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                Cerrar sesión
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            </div>
        </header>
    );
}
