'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoginPage() {
    const router = useRouter();
    const [form,  setForm]  = useState({ username: '', password: '' });

    // Si la DB está vacía → redirigir al setup
    useEffect(() => {
        fetch('/api/setup').then(r => r.json())
            .then((d: { setupRequired: boolean }) => { if (d.setupRequired) router.push('/setup'); })
            .catch(() => {});
    }, [router]);
    const [error, setError] = useState('');
    const [loading, setLoad] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(''); setLoad(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json() as { token?: string; error?: string };
            if (!res.ok || !data.token) { setError(data.error ?? 'Error desconocido'); setLoad(false); return; }
            sessionStorage.setItem('auth_token', data.token);
            router.push('/admin');
        } catch { setError('No se pudo conectar al servidor'); setLoad(false); }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-sm animate-fade-in">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
                        <Shield className="w-7 h-7 text-primary" />
                    </div>
                    <h1 className="text-xl font-semibold">Auth Service</h1>
                    <p className="text-sm text-muted-foreground mt-1">Acceso solo para administradores</p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    {(['username', 'password'] as const).map(field => (
                        <div key={field} className="space-y-2">
                            <label className="text-sm font-medium capitalize">{field === 'username' ? 'Usuario' : 'Contraseña'}</label>
                            <input
                                type={field === 'password' ? 'password' : 'text'}
                                value={form[field]}
                                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                                autoFocus={field === 'username'}
                                className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40')}
                            />
                        </div>
                    ))}
                    {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
                    <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Ingresando...</> : 'Ingresar'}
                    </button>
                </form>
            </div>
        </div>
    );
}
