'use client';
import type React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Bot, Workflow, Container, ChevronLeft, ChevronRight, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/components/ui';

interface NavItem {
    href:      string;
    icon:      React.ComponentType<{ className?: string }>;
    label:     string;
    disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
    { href: '/runs',      icon: LayoutGrid, label: 'Runs'      },
    { href: '/agents',    icon: Bot,        label: 'Agents'    },
    { href: '/workflows', icon: GitBranch,  label: 'Workflows' },
    { href: '/flows',     icon: Workflow,   label: 'Flows'     },
    { href: '/deploy',    icon: Container,  label: 'Deploy'    },
];

export function Sidebar() {
    const pathname   = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <aside className={cn(
            'flex flex-col border-r border-border bg-card transition-all duration-200 shrink-0',
            collapsed ? 'w-14' : 'w-52',
        )}>
            {/* Brand */}
            <div className="flex h-14 items-center gap-3 border-b border-border px-3.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20">
                    <Bot className="h-4 w-4 text-primary" />
                </div>
                {!collapsed && (
                    <span className="text-sm font-semibold text-foreground">Agent Studio</span>
                )}
            </div>

            {/* Nav */}
            <nav className="flex flex-col gap-1 p-2 flex-1">
                {NAV_ITEMS.map(({ href, icon: Icon, label, disabled }) => {
                    const active = pathname?.startsWith(href) ?? false;
                    return (
                        <Link
                            key={href}
                            href={disabled ? '#' : href}
                            aria-disabled={disabled}
                            className={cn(
                                'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                                active
                                    ? 'bg-accent text-foreground'
                                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                                disabled && 'pointer-events-none opacity-40',
                            )}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            {!collapsed && (
                                <span className="flex-1 truncate">{label}</span>
                            )}
                            {!collapsed && disabled && (
                                <span className="text-[10px] text-muted-foreground">soon</span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Collapse toggle */}
            <button
                onClick={() => setCollapsed(c => !c)}
                className="flex h-10 items-center justify-center border-t border-border text-muted-foreground hover:text-foreground transition-colors"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {collapsed
                    ? <ChevronRight className="h-4 w-4" />
                    : <ChevronLeft  className="h-4 w-4" />
                }
            </button>
        </aside>
    );
}
