'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'block w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
          'placeholder:text-muted-foreground focus:outline-none focus:ring-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-destructive focus:border-destructive focus:ring-destructive'
            : 'border-input focus:border-ring focus:ring-ring',
          className,
        )}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}