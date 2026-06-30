import React from 'react';
import { cn } from '@/lib/utils';

interface TopbarProps {
  title: string;
  subtitle?: string;
  className?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, className, actions }: TopbarProps) {
  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur',
        className,
      )}
    >
      <div className="flex flex-col leading-none">
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
