import { cn } from '@/lib/utils';
import { MessageSquare, LayoutDashboard } from 'lucide-react';

const TABS = [
  { hash: '',        label: 'Chat',    Icon: MessageSquare },
  { hash: '#kanban', label: 'Monitor', Icon: LayoutDashboard },
];

export function NavTabs() {
  const current = window.location.hash;

  return (
    <div className="flex items-center gap-0.5">
      {TABS.map(({ hash, label, Icon }) => {
        const active = current === hash || (hash === '' && current !== '#kanban');
        return (
          <a
            key={hash}
            href={hash || '#'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </a>
        );
      })}
    </div>
  );
}
