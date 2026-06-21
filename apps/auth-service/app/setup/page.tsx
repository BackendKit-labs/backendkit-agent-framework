'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SetupPage() {
    const router = useRouter();
    const [checking, setChecking] = useState(true);
    const [form, setForm] = useState({ username: 'admin', password: '', confirm: '', name: '' });
    const [error, setError] = useState('');
    const [saving, setSave] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        fetch('/api/setup')
            .then(r => r.json())
            .then((d: { setupRequired: boolean }) => {
                if (!d.setupRequired) router.push('/login');
                else setChecking(false);
            })
            .catch(() => setChecking(false));
    }, [router]);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (form.password !== form.confirm) { setError('Las contraseñas no coinciden'); return; }
        if (form.password.length < 10) { setError('La contraseña debe tener al menos 10 caracteres'); return; }
        setSave(true); setError('');

        const res = await fetch('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: form.username, password: form.password, name: form.name || undefined }),
        });
        const data = await res.json() as { ok?: boolean; error?: string };

        if (!res.ok) { setError(data.error ?? 'Error'); setSave(false); return; }
        setDone(true);
        setTimeout(() => router.push('/login'), 2000);
    }

    if (checking) return null;

    if (done) return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="text-center animate-fade-in space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <p className="text-lg font-semibold">¡Setup completado!</p>
                <p className="text-sm text-muted-foreground">Redirigiendo al login...</p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-sm animate-fade-in">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
                        <Shield className="w-7 h-7 text-primary" />
                    </div>
                    <h1 className="text-xl font-semibold">Configuración inicial</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Creá el primer usuario administrador.<br />
                        Este formulario solo está disponible una vez.
                    </p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    {[
                        { key: 'name',     label: 'Nombre completo',        type: 'text',     ph: 'Administrador' },
                        { key: 'username', label: 'Username *',             type: 'text',     ph: 'admin' },
                        { key: 'password', label: 'Contraseña * (mín. 10)', type: 'password', ph: '' },
                        { key: 'confirm',  label: 'Confirmar contraseña *', type: 'password', ph: '' },
                    ].map(({ key, label, type, ph }) => (
                        <div key={key} className="space-y-1">
                            <label className="text-sm font-medium">{label}</label>
                            <input type={type} value={form[key as keyof typeof form]} placeholder={ph}
                                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border',
                                    'text-foreground placeholder:text-muted-foreground',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/40')}
                            />
                        </div>
                    ))}

                    {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

                    <button type="submit" disabled={saving}
                        className="w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Creando...</> : 'Crear administrador'}
                    </button>
                </form>

                <p className="text-center text-xs text-muted-foreground mt-6">
                    BackendKit Auth Service · Setup único
                </p>
            </div>
        </div>
    );
}
