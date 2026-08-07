import { useState, useEffect } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import { cn } from '../lib/utils';
import { getWsUrl, type WsUser, type WsIncoming } from '../lib/ws';

interface Props {
  onLogin: (user: WsUser, token: string, ws: WebSocket) => void;
}

export default function Login({ onLogin }: Props) {
  const [form,    setForm]  = useState({ email: '', password: '' });
  const [error,   setError] = useState('');
  const [loading, setLoad]  = useState(false);

  useEffect(() => {
    // Si no requiere auth, conectar directamente
    const ws = new WebSocket(getWsUrl());
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsIncoming;
      if (msg.type === 'ready' && !msg.auth_required) {
        onLogin({ id: 'anon', roles: ['admin'] }, '', ws);
      }
    };
    ws.onerror = () => ws.close();
    return () => { if (ws.readyState === WebSocket.CONNECTING) ws.close(); };
  }, []); // eslint-disable-line

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.password) { setError('Completá email y contraseña'); return; }
    setError(''); setLoad(true);

    const ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'login', email: form.email, password: form.password }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsIncoming;
      if (msg.type === 'ready') return; // esperar auth_ok
      if (msg.type === 'auth_ok') {
        onLogin(msg.user, msg.token, ws);
      } else if (msg.type === 'auth_error') {
        setError(msg.error ?? 'Credenciales inválidas');
        setLoad(false);
        ws.close();
      }
    };

    ws.onerror = () => { setError('No se pudo conectar al director'); setLoad(false); };
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 mb-4">
            <Terminal className="w-7 h-7 text-zinc-300" />
          </div>
          <h1 className="text-xl font-semibold">BackendKit Director</h1>
          <p className="text-sm text-zinc-500 mt-1">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="tu@empresa.com"
              autoFocus
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm',
                'bg-zinc-900 border border-zinc-700',
                'text-zinc-100 placeholder:text-zinc-600',
                'focus:outline-none focus:ring-2 focus:ring-zinc-500',
                'transition-colors'
              )}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Contraseña</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm',
                'bg-zinc-900 border border-zinc-700',
                'text-zinc-100 placeholder:text-zinc-600',
                'focus:outline-none focus:ring-2 focus:ring-zinc-500',
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
              'bg-zinc-100 text-zinc-900',
              'hover:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-600 mt-6">
          BackendKit Platform · Director Agent
        </p>
      </div>
    </div>
  );
}
