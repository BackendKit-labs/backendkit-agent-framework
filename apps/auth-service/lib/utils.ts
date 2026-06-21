import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function roleBg(role: string): string {
    const map: Record<string, string> = {
        admin: 'bg-rose-400/10 text-rose-400 border-rose-400/20',
        development: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
        devops: 'bg-sky-400/10 text-sky-400 border-sky-400/20',
        hr: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
        sales: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
        finance: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
        viewer: 'bg-zinc-400/10 text-zinc-400 border-zinc-400/20',
    };
    return map[role] ?? 'bg-zinc-400/10 text-zinc-400 border-zinc-400/20';
}
