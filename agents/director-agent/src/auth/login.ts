import { verifyToken } from './jwt.js';
import type { Principal } from './types.js';

const ABAC_URL = process.env['ABAC_URL'] ?? 'http://localhost:3005';

export type LoginResult =
    | { ok: true;  token: string; user: Principal }
    | { ok: false; error: string };

/**
 * Autentica un usuario contra abac-service (POST /auth/login).
 * El endpoint acepta cualquier usuario activo con al menos un rol en la app
 * (admin incluido) — el director no es una consola de administración, así que
 * no corresponde exigir rol admin para chatear.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
    if (!process.env['ABAC_PUBLIC_KEY']) {
        return { ok: false, error: 'ABAC_PUBLIC_KEY no configurado — modo empresa no habilitado' };
    }

    try {
        const res = await fetch(`${ABAC_URL}/auth/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password }),
            signal:  AbortSignal.timeout(5_000),
        });

        const data = await res.json() as { accessToken?: string; message?: string };

        if (!res.ok || !data.accessToken) {
            return { ok: false, error: data.message ?? 'Error de autenticación' };
        }

        const principal = await verifyToken(data.accessToken);
        return { ok: true, token: data.accessToken, user: principal };

    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
            return { ok: false, error: `abac-service no disponible (${ABAC_URL}). ¿Está corriendo?` };
        }
        return { ok: false, error: msg };
    }
}
