import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title:       { default: 'Vault Manager', template: '%s — Vault Manager' },
    description: 'Knowledge vault ingestion and audit dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es" className="dark">
            <body className="antialiased">{children}</body>
        </html>
    );
}
