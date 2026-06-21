'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Shield, Users, LogOut, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router   = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const token = sessionStorage.getItem('auth_token');
        if (!token) { router.push('/login'); return; }
        setReady(true);
    }, [router]);

    function logout() { sessionStorage.clear(); router.push('/login'); }

    if (!ready) return null;

    const nav = [
        { href: '/admin',       label: 'Dashboard', icon: LayoutDashboard },
        { href: '/admin/users', label: 'Usuarios',  icon: Users },
    ];

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <aside className="w-56 border-r border-border bg-secondary/20 flex flex-col shrink-0">
                <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Shield className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold">Auth Service</p>
                            <p className="text-xs text-muted-foreground">BackendKit</p>
                        </div>
                    </div>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {nav.map(({ href, label, icon: Icon }) => (
                        <Link key={href} href={href} className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                            pathname === href || (href !== '/admin' && pathname.startsWith(href))
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}>
                            <Icon className="w-4 h-4" /> {label}
                        </Link>
                    ))}
                </nav>
                <div className="p-3 border-t border-border">
                    <button onClick={logout} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-full">
                        <LogOut className="w-4 h-4" /> Cerrar sesión
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
    );
}
