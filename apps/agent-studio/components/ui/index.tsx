'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export { cn } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

// ── Button ────────────────────────────────────────────────────────────────────

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default:     'bg-primary text-primary-foreground shadow hover:bg-primary/90',
                destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
                outline:     'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
                secondary:   'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
                ghost:       'hover:bg-accent hover:text-accent-foreground',
            },
            size: {
                default: 'h-9 px-4 py-2',
                sm:      'h-8 rounded-md px-3 text-xs',
                lg:      'h-10 rounded-md px-8',
                icon:    'h-9 w-9',
            },
        },
        defaultVariants: { variant: 'default', size: 'default' },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, ...props }, ref) => (
        <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    ),
);
Button.displayName = 'Button';

// ── Badge ─────────────────────────────────────────────────────────────────────

const badgeVariants = cva(
    'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
    {
        variants: {
            variant: {
                default:     'border-transparent bg-primary text-primary-foreground',
                secondary:   'border-transparent bg-secondary text-secondary-foreground',
                destructive: 'border-transparent bg-destructive text-destructive-foreground',
                outline:     'text-foreground',
            },
        },
        defaultVariants: { variant: 'default' },
    },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// ── Card ──────────────────────────────────────────────────────────────────────

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('rounded-xl border bg-card text-card-foreground shadow', className)} {...props} />
    ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
    ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
    ),
);
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
    ),
);
CardContent.displayName = 'CardContent';

// ── Textarea ──────────────────────────────────────────────────────────────────

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
                className,
            )}
            {...props}
        />
    ),
);
Textarea.displayName = 'Textarea';

// ── Dialog ────────────────────────────────────────────────────────────────────
// Pure HTML implementation — avoids @types/react@18.3 × Radix UI type mismatch

export function Dialog({ open, onOpenChange, children }: {
    open?:          boolean;
    onOpenChange?:  (open: boolean) => void;
    children?:      React.ReactNode;
}) {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    if (!open || !mounted) return null;
    return createPortal(
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/80 animate-in fade-in-0" onClick={() => onOpenChange?.(false)} />
            <div className="relative z-10 w-full max-w-md">{children}</div>
        </div>,
        document.body,
    );
}

export const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                'relative grid w-full gap-4 rounded-lg border bg-background p-6 shadow-lg animate-in fade-in-0 zoom-in-95',
                className,
            )}
            {...props}
        >
            {children}
        </div>
    ),
);
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('flex flex-col space-y-1.5', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return <h2 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('flex justify-end gap-2', className)} {...props} />;
}
