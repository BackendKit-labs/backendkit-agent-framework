'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  isLoading?: boolean;
  className?: string;
}

export function MetricCard({
  title,
  value,
  icon,
  description,
  trend,
  isLoading = false,
  className,
}: MetricCardProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border bg-card p-6 shadow',
          className
        )}
      >
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-8 w-16 rounded" />
          </div>
          <div className="skeleton h-10 w-10 rounded-lg" />
        </div>
        {description && (
          <div className="skeleton mt-2 h-3 w-32 rounded" />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-6 text-card-foreground shadow transition-shadow hover:border-primary/40',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
        </div>
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15 text-primary">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {trend && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              trend.isPositive
                ? 'bg-primary/15 text-primary'
                : 'bg-destructive/20 text-destructive-foreground'
            )}
          >
            <svg
              className={cn(
                'h-3 w-3',
                trend.isPositive ? 'rotate-0' : 'rotate-180'
              )}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 15.75l7.5-7.5 7.5 7.5"
              />
            </svg>
            {trend.isPositive ? '+' : '-'}
            {Math.abs(trend.value)}%
          </span>
        )}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}