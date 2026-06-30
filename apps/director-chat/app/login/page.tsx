'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Loader2, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const [form,    setForm]  = useState({ email: '', password: '' });
  const [error,   setError] = useState('');
  const [loading, setLoad]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.password) { setError('Completá email y contraseña'); return; }
    setError(''); setLoad(true);

    const result = await signIn('credentials', {
      email:    form.email,
      password: form.password,
      redirect: false,
    });

    if (result?.error) {
      setError('Credenciales inválidas');
      setLoad(false);
      return;
    }

    window.location.href = '/chat';
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Terminal className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">BackendKit Director</h1>
          <p className="text-sm text-muted-foreground mt-1">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="tu@empresa.com"
              autoFocus
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm',
                'bg-secondary border border-border',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50',
                'transition-colors'
              )}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Contraseña</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm',
                'bg-secondary border border-border',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50',
                'transition-colors'
              )}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full py-2.5 rounded-lg text-sm font-medium transition-all',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          BackendKit Platform · Director Agent
        </p>
      </div>
    </div>
  );
}
