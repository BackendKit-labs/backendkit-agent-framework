import { jwtVerify, SignJWT } from 'jose';
import type { Principal } from './types.js';

// Lee JWT_SECRET en cada llamada — evita el problema de ESM hoisting donde
// el módulo se evalúa antes de que dotenv/config cargue el .env.
function getSecret(): Uint8Array | null {
    const key = process.env['JWT_SECRET'];
    return key ? new TextEncoder().encode(key) : null;
}

/** true cuando JWT_SECRET está seteado → modo empresa activo. */
export const isEnterpriseMode = (): boolean => !!process.env['JWT_SECRET'];

/**
 * Verifica un JWT HS256 y extrae el Principal.
 * El token debe tener: sub (userId), role, department? (opcionales).
 */
export async function verifyToken(token: string): Promise<Principal> {
    const secret = getSecret();
    if (!secret) {
        throw new Error('JWT_SECRET no configurado — modo empresa no habilitado');
    }
    try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
        const id         = typeof payload['sub'] === 'string' ? payload['sub'] : '';
        const role       = typeof payload['role'] === 'string' ? payload['role'] : 'guest';
        const department = typeof payload['department'] === 'string' ? payload['department'] : undefined;
        if (!id) throw new Error('falta sub');
        return { id, role, department };
    } catch (cause) {
        throw new Error(`Token inválido: ${(cause as Error).message}`);
    }
}

/**
 * Firma un JWT de desarrollo/testing.
 * Solo funciona si JWT_SECRET está seteado.
 */
export async function signToken(principal: Principal, expiresIn = '8h'): Promise<string> {
    const secret = getSecret();
    if (!secret) throw new Error('JWT_SECRET no configurado');
    return new SignJWT({ role: principal.role, department: principal.department })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(principal.id)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secret);
}
