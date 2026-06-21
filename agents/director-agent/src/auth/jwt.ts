import { jwtVerify, SignJWT } from 'jose';
import type { Principal } from './types.js';

// Soporta AUTH_SECRET (auth-service unificado) y JWT_SECRET (legacy director-only).
// AUTH_SECRET tiene prioridad.
function getSecret(): Uint8Array | null {
    const key = process.env['AUTH_SECRET'] ?? process.env['JWT_SECRET'];
    return key ? new TextEncoder().encode(key) : null;
}

/** true cuando el modo empresa está activo (AUTH_SECRET o JWT_SECRET seteado). */
export const isEnterpriseMode = (): boolean =>
    !!(process.env['AUTH_SECRET'] ?? process.env['JWT_SECRET']);

/**
 * Verifica un JWT HS256 y extrae el Principal completo.
 * Soporta JWTs emitidos por auth-service (con tools/vault/apps)
 * y JWTs legacy del director (solo sub/role/department).
 */
export async function verifyToken(token: string): Promise<Principal> {
    const secret = getSecret();
    if (!secret) throw new Error('AUTH_SECRET no configurado');
    try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
        return {
            id:         typeof payload['sub']  === 'string' ? payload['sub']  : '',
            role:       typeof payload['role'] === 'string' ? payload['role'] : 'viewer',
            department: typeof payload['dept'] === 'string' ? payload['dept'] : undefined,
            tools:      Array.isArray(payload['tools']) ? payload['tools'] as string[]  : undefined,
            vault:      Array.isArray(payload['vault']) ? payload['vault'] as string[]  : undefined,
            apps:       Array.isArray(payload['apps'])  ? payload['apps']  as string[]  : undefined,
        };
    } catch (cause) {
        throw new Error(`Token inválido: ${(cause as Error).message}`);
    }
}

/**
 * Firma un JWT legacy (sin workspace) — solo para testing/dev.
 * En producción los JWTs los emite auth-service.
 */
export async function signToken(principal: Principal, expiresIn = '8h'): Promise<string> {
    const secret = getSecret();
    if (!secret) throw new Error('AUTH_SECRET no configurado');
    return new SignJWT({ role: principal.role, dept: principal.department })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(principal.id)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secret);
}
