export interface WsUser {
  id:         string;
  name?:      string;
  email?:     string;
  roles?:     string[];
  role?:      string;
  department?: string;
}

export type WsIncoming =
  | { type: 'ready';       auth_required: boolean }
  | { type: 'auth_ok';     token: string; user: WsUser }
  | { type: 'auth_error';  error: string }
  | { type: 'token';       content: string }
  | { type: 'tool_call';   name: string; server: string; preview?: string }
  | { type: 'tool_result'; name: string; success: boolean; preview?: string }
  | { type: 'done' }
  | { type: 'error';       message: string };

export type WsOutgoing =
  | { type: 'login';  email: string; password: string }
  | { type: 'auth';   token: string }
  | { type: 'chat';   message: string }
  | { type: 'clear' };

export function getWsUrl(): string {
  return (window as any).__DIRECTOR_WS_URL__ ?? `ws://${window.location.host}`;
}

export function primaryRole(user: WsUser): string {
  if (user.roles?.length) return user.roles[0];
  return user.role ?? 'viewer';
}

export function roleBg(role: string): string {
  switch (role) {
    case 'admin':       return 'bg-rose-400/10 text-rose-400';
    case 'development': return 'bg-blue-400/10 text-blue-400';
    case 'devops':      return 'bg-sky-400/10 text-sky-400';
    case 'hr':          return 'bg-purple-400/10 text-purple-400';
    case 'sales':       return 'bg-emerald-400/10 text-emerald-400';
    case 'finance':     return 'bg-amber-400/10 text-amber-400';
    default:            return 'bg-zinc-400/10 text-zinc-400';
  }
}
