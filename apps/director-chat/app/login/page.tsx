'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWsUrl, type WsIncoming } from '@/lib/ws';

export default function LoginPage() {
  const router   = useRouter();
  const wsRef    = useRef<WebSocket | null>(null);
  const [form,   setForm]   = useState({ username: '', password: '' });
  const [error,  setError]  = useState('');
  const [loading, setLoad]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username || !form.password) { setError('Completá usuario y contraseña'); return; }
    setError(''); setLoad(true);

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      // Esperar el mensaje 'ready' antes de enviar login
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsIncoming;

      if (msg.type === 'ready') {
        ws.send(JSON.stringify({ type: 'login', username: form.username, password: form.password }));
        return;
      }
      if (msg.type === 'auth_ok') {
        sessionStorage.setItem('director_token', msg.token);
        sessionStorage.setItem('director_user', JSON.stringify(msg.user));
        ws.close();
        router.push('/chat');
        return;
      }
      if (msg.type === 'auth_error') {
        setError(msg.error);
        setLoad(false);
        ws.close();
        return;
      }
    };

    ws.onerror = () => { setError('No se pudo conectar al Director (ws://localhost:3500)'); setLoad(false); };
    ws.onclose = () => { if (loading) { setLoad(false); } };
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Terminal className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">BackendKit Director</h1>
          <p className="text-sm text-muted-foreground mt-1">Iniciá sesión para continuar</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Usuario</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="tu.usuario"
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
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Conectando...</> : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          BackendKit Platform · Director Agent
        </p>
      </div>
    </div>
  );
}
