'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary text-primary-foreground shadow hover:bg-primary/90 focus-visible:ring-ring',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 focus-visible:ring-ring',
  danger: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive',
  ghost: 'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
  outline: 'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 rounded-md px-3 text-xs',
  md: 'h-9 rounded-md px-4 text-sm',
  lg: 'h-10 rounded-md px-8 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-0',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
