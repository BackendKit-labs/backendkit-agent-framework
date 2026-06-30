'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Terminal, Kanban, MessageSquare, History, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type WsUser, primaryRole, roleBg } from '@/lib/ws';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<WsUser | null>(null);

  useEffect(() => {
    const token   = sessionStorage.getItem('director_token');
    const userRaw = sessionStorage.getItem('director_user');
    if (!token || !userRaw) { router.push('/login'); return; }
    try { setUser(JSON.parse(userRaw) as WsUser); } catch { router.push('/login'); }
  }, [router]);

  function logout() {
    sessionStorage.clear();
    router.push('/login');
  }

  if (!user) return null;

  const role = primaryRole(user);
  const displayName = user.name ?? user.email ?? user.id;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Nav */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm font-semibold text-foreground hidden sm:block">Director</span>
          </div>

          <nav className="flex items-center gap-1">
            <Link
              href="/chat"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                pathname === '/chat'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </Link>
            <Link
              href="/kanban"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                pathname === '/kanban'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span>Kanban</span>
            </Link>
            <Link
              href="/runs"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                pathname === '/runs'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', roleBg(role))}>
              {role}
            </span>
            <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[140px]">
              {displayName}
            </span>
          </div>
          <button
            onClick={logout}
            title="Cerrar sesión"
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
