'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
    Shield, Users, LogOut, LayoutDashboard, Building2, ShieldCheck,
    ChevronRight, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const NAV = [
    { href: '/admin',             label: 'Dashboard',     icon: LayoutDashboard },
    { href: '/admin/users',       label: 'Usuarios',      icon: Users },
    { href: '/admin/roles',       label: 'Roles',         icon: ShieldCheck },
    { href: '/admin/departments', label: 'Departamentos', icon: Building2 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router    = useRouter();
    const pathname  = usePathname();
    const [ready,     setReady]     = useState(false);
    const [collapsed, setCollapsed] = useState(true);

    useEffect(() => {
        const token = sessionStorage.getItem('auth_token');
        if (!token) { router.push('/login'); return; }
        setReady(true);
    }, [router]);

    function logout() { sessionStorage.clear(); router.push('/login'); }

    const isActive = (href: string) =>
        href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

    if (!ready) return null;

    return (
        <div className="flex h-screen">
            <aside className={cn(
                'relative flex h-screen flex-col border-r border-border bg-card transition-all duration-200 shrink-0',
                collapsed ? 'w-14' : 'w-60',
            )}>
                {/* Logo */}
                <div className="flex h-14 items-center gap-3 border-b border-border px-3 overflow-hidden">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                        <Shield className="h-4 w-4 text-primary" />
                    </div>
                    {!collapsed && (
                        <div className="flex flex-col leading-none whitespace-nowrap">
                            <span className="text-sm font-semibold">Auth Service</span>
                            <span className="text-[10px] text-muted-foreground">BackendKit</span>
                        </div>
                    )}
                </div>

                {/* Nav */}
                <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                    {NAV.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            title={collapsed ? label : undefined}
                            className={cn(
                                'group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-all',
                                collapsed && 'justify-center',
                                isActive(href)
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                            )}
                        >
                            <Icon className={cn('h-4 w-4 shrink-0', isActive(href) ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                            {!collapsed && (
                                <>
                                    <span className="flex-1 whitespace-nowrap">{label}</span>
                                    {isActive(href) && <ChevronRight className="h-3 w-3 text-primary opacity-60" />}
                                </>
                            )}
                        </Link>
                    ))}
                </nav>

                {/* Footer: logout + toggle */}
                <div className="border-t border-border p-2 flex flex-col gap-2">
                    <button
                        onClick={logout}
                        title={collapsed ? 'Cerrar sesión' : undefined}
                        className={cn(
                            'flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-full',
                            collapsed && 'justify-center',
                        )}
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="whitespace-nowrap">Cerrar sesión</span>}
                    </button>
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
                    >
                        {collapsed
                            ? <PanelLeftOpen  className="h-4 w-4" />
                            : <PanelLeftClose className="h-4 w-4" />
                        }
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
    );
}
