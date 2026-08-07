import { useState } from 'react';
import Login  from './pages/Login';
import Layout from './pages/Layout';
import Chat   from './pages/Chat';
import type { WsUser } from './lib/ws';

type Page  = 'chat' | 'kanban' | 'runs';
type State = 'login' | 'app';

interface Session { user: WsUser; token: string; ws: WebSocket; }

export default function App() {
  const [state,   setState]   = useState<State>('login');
  const [session, setSession] = useState<Session | null>(null);
  const [page,    setPage]    = useState<Page>('chat');

  function handleLogin(user: WsUser, token: string, ws: WebSocket) {
    setSession({ user, token, ws });
    setState('app');
  }

  function handleLogout() {
    session?.ws.close();
    setSession(null);
    setState('login');
  }

  if (state === 'login' || !session) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Layout user={session.user} page={page} onPage={setPage} onLogout={handleLogout}>
      {page === 'chat' && <Chat ws={session.ws} user={session.user} />}
      {page === 'kanban' && (
        <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
          Kanban — próximamente
        </div>
      )}
      {page === 'runs' && (
        <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
          Historial de runs — próximamente
        </div>
      )}
    </Layout>
  );
}
