import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

export function Card({ children, className = '', title, description }: CardProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-6 text-card-foreground shadow', className)}>
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}