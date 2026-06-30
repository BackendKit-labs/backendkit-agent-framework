import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Director · BackendKit',
  description: 'Interfaz conversacional del ecosistema BackendKit',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
