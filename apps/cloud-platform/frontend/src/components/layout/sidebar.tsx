'use client';

import type React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutGrid,
  FolderOpen,
  Bot,
  Server,
  Package,
  Workflow,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', icon: LayoutGrid, label: 'Dashboard' },
  { href: '/dashboard/departments', icon: FolderOpen, label: 'Departamentos' },
  { href: '/dashboard/deployables', icon: Bot, label: 'Deployables' },
  { href: '/dashboard/catalog', icon: Package, label: 'Catálogo' },
  { href: '/dashboard/workflows', icon: Workflow, label: 'Workflows' },
  { href: '/dashboard/director', icon: Server, label: 'Director' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : (pathname?.startsWith(href) ?? false);

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-14' : 'w-52',
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-3 border-b border-border px-3.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20">
          <Server className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && <span className="text-sm font-semibold text-foreground">Agent Cloud</span>}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-border p-2">
        <button
          onClick={handleLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 truncate text-left">Cerrar sesión</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-10 items-center justify-center border-t border-border text-muted-foreground transition-colors hover:text-foreground"
        title={collapsed ? 'Expandir' : 'Colapsar'}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
