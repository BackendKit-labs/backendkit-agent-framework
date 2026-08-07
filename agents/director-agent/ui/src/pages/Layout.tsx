import { MessageSquare, Columns, Activity, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { primaryRole, roleBg, type WsUser } from '../lib/ws';

type Page = 'chat' | 'kanban' | 'runs';

interface Props {
  user:     WsUser;
  page:     Page;
  onPage:   (p: Page) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV: { id: Page; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: 'chat',   label: 'Chat',   Icon: MessageSquare },
  { id: 'kanban', label: 'Kanban', Icon: Columns       },
  { id: 'runs',   label: 'Runs',   Icon: Activity       },
];

export default function Layout({ user, page, onPage, onLogout, children }: Props) {
  const role  = primaryRole(user);
  const label = user.name ?? user.email ?? user.id;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-4 h-12 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-1">
          {NAV.map(({ id, label: l, Icon }) => (
            <button
              key={id}
              onClick={() => onPage(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                page === id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              )}
            >
              <Icon className="w-4 h-4" />
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium', roleBg(role))}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
            {label}
            <span className="opacity-60">· {role}</span>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
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
