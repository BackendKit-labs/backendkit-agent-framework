'use client';
import { signOut } from 'next-auth/react';
import { Bell, LogOut, Search, User } from 'lucide-react';
import { Button, cn } from '@/components/ui';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface TopbarProps {
    title:       string;
    subtitle?:   string;
    userName?:   string;
    userEmail?:  string;
    userRole?:   string;
    actions?:    React.ReactNode;
}

const ROLE_COLORS: Record<string, string> = {
    admin:     'text-rose-400',
    technical: 'text-blue-400',
    business:  'text-purple-400',
    viewer:    'text-zinc-400',
};

export function Topbar({ title, subtitle, userName, userEmail, userRole = 'viewer', actions }: TopbarProps) {
    return (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
            {/* Title */}
            <div className="flex flex-col leading-none">
                <h1 className="text-sm font-semibold text-foreground">{title}</h1>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
                {/* Search */}
                <button className="flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-xs text-muted-foreground transition-colors hover:border-input hover:bg-muted">
                    <Search className="h-3.5 w-3.5" />
                    <span>Buscar...</span>
                    <kbd className="ml-2 rounded border border-border bg-background px-1.5 text-[10px]">⌘K</kbd>
                </button>

                {/* Notifications */}
                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                    <Bell className="h-4 w-4" />
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                </Button>

                {/* Extra actions */}
                {actions}

                {/* User menu */}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <button className="flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:bg-accent">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                                <User className="h-3 w-3 text-primary" />
                            </div>
                            <span className="max-w-[100px] truncate text-muted-foreground">{userName ?? 'Usuario'}</span>
                            <span className={cn('font-medium', ROLE_COLORS[userRole] ?? 'text-zinc-400')}>
                                {userRole}
                            </span>
                        </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            align="end"
                            sideOffset={6}
                            className="z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
                        >
                            <div className="px-2 py-1.5">
                                <p className="text-sm font-medium">{userName}</p>
                                <p className="text-xs text-muted-foreground">{userEmail}</p>
                            </div>
                            <DropdownMenu.Separator className="my-1 h-px bg-border" />
                            <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive"
                                onSelect={() => signOut({ callbackUrl: '/login' })}
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                Cerrar sesión
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            </div>
        </header>
    );
}
