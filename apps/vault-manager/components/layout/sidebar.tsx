'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard, Upload, ClipboardCheck, Database,
    Sparkles, Users, Settings, ChevronRight,
    BookOpen, Shield, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/components/ui';

interface NavItem {
    href:    string;
    label:   string;
    icon:    React.ElementType;
    badge?:  number;
    roles?:  string[];
}

const NAV_MAIN: NavItem[] = [
    { href: '/',        label: 'Dashboard',    icon: LayoutDashboard },
    { href: '/ingest',  label: 'Ingesta',      icon: Upload },
    { href: '/audit',   label: 'Auditoría',    icon: ClipboardCheck, badge: 0 },
    { href: '/vault',   label: 'Vaults',       icon: Database },
    { href: '/improve', label: 'Mejora AI',    icon: Sparkles },
];

const NAV_ADMIN: NavItem[] = [
    { href: '/users',    label: 'Usuarios',      icon: Users,    roles: ['admin'] },
    { href: '/settings', label: 'Configuración', icon: Settings, roles: ['admin'] },
];

interface SidebarProps {
    userRole?:     string;
    pendingCount?: number;
}

export function Sidebar({ userRole = 'viewer', pendingCount = 0 }: SidebarProps) {
    const pathname  = usePathname();
    const [collapsed, setCollapsed] = useState(true);

    const isActive = (href: string) =>
        href === '/' ? pathname === '/' : pathname.startsWith(href);

    return (
        <aside
            className={cn(
                'relative flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
                collapsed ? 'w-14' : 'w-60',
            )}
        >
            {/* Logo */}
            <div className="flex h-14 items-center gap-3 border-b border-border px-3 overflow-hidden">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <BookOpen className="h-4 w-4 text-primary" />
                </div>
                {!collapsed && (
                    <div className="flex flex-col leading-none whitespace-nowrap">
                        <span className="text-sm font-semibold">Vault Manager</span>
                        <span className="text-[10px] text-muted-foreground">BackendKit Labs</span>
                    </div>
                )}
            </div>

            {/* Main nav */}
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                {!collapsed && (
                    <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Operaciones
                    </p>
                )}
                {NAV_MAIN.map((item) => (
                    <NavLink
                        key={item.href}
                        item={{ ...item, badge: item.href === '/audit' ? pendingCount : item.badge }}
                        active={isActive(item.href)}
                        collapsed={collapsed}
                    />
                ))}

                {userRole === 'admin' && (
                    <>
                        {!collapsed && (
                            <p className="mb-1 mt-4 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Administración
                            </p>
                        )}
                        {collapsed && <div className="my-2 border-t border-border" />}
                        {NAV_ADMIN.map((item) => (
                            <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
                        ))}
                    </>
                )}
            </nav>

            {/* Role badge + toggle */}
            <div className="border-t border-border p-2 flex flex-col gap-2">
                {!collapsed && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <Shield className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground capitalize whitespace-nowrap">
                            Rol: <span className="text-foreground font-medium">{userRole}</span>
                        </span>
                    </div>
                )}
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
    );
}

function NavLink({
    item, active, collapsed,
}: {
    item: NavItem;
    active: boolean;
    collapsed: boolean;
}) {
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
                'group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-all',
                collapsed && 'justify-center',
                active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
        >
            <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />

            {!collapsed && (
                <>
                    <span className="flex-1 whitespace-nowrap">{item.label}</span>
                    {(item.badge !== undefined && item.badge > 0) && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">
                            {item.badge > 99 ? '99+' : item.badge}
                        </span>
                    )}
                    {active && <ChevronRight className="h-3 w-3 text-primary opacity-60" />}
                </>
            )}

            {/* Badge dot when collapsed */}
            {collapsed && item.badge !== undefined && item.badge > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
            )}
        </Link>
    );
}
