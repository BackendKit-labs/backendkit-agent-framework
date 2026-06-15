import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title:       { default: 'Agent Studio', template: '%s — Agent Studio' },
    description: 'Real-time orchestrator monitoring and agent management dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es" className="dark">
            <body className="antialiased">{children}</body>
        </html>
    );
}
