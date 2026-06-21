import { verifyToken } from './jwt.js';
import type { Principal } from './types.js';

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4000';

export type LoginResult =
    | { ok: true;  token: string; user: Principal }
    | { ok: false; error: string };

/**
 * Autentica un usuario contra el auth-service centralizado.
 * Llama a POST {AUTH_SERVICE_URL}/api/auth/login y verifica el JWT retornado.
 * El JWT lleva el workspace del usuario (tools, vault, apps) embebido.
 */
export async function login(username: string, password: string): Promise<LoginResult> {
    const key = process.env['AUTH_SECRET'] ?? process.env['JWT_SECRET'];
    if (!key) {
        return { ok: false, error: 'AUTH_SECRET no configurado — modo empresa no habilitado' };
    }

    try {
        const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password }),
            signal:  AbortSignal.timeout(5_000),
        });

        const data = await res.json() as { token?: string; error?: string };

        if (!res.ok || !data.token) {
            return { ok: false, error: data.error ?? 'Error de autenticación' };
        }

        // Verifica el JWT con la clave compartida y extrae el workspace
        const principal = await verifyToken(data.token);
        return { ok: true, token: data.token, user: principal };

    } catch (err) {
        const msg = (err as Error).message;
        // Fallback informativo: si el auth-service no está disponible
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
            return { ok: false, error: `Auth service no disponible (${AUTH_SERVICE_URL}). ¿Está corriendo?` };
        }
        return { ok: false, error: msg };
    }
}
