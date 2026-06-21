import { SignJWT } from 'jose';
import { findUser, verifyPassword } from './user-store.js';
import type { Principal } from './types.js';

export type LoginResult =
    | { ok: true;  token: string; user: Principal }
    | { ok: false; error: string };

export async function login(username: string, password: string): Promise<LoginResult> {
    const key = process.env['JWT_SECRET'];
    if (!key) {
        return { ok: false, error: 'JWT_SECRET no configurado — modo empresa no habilitado' };
    }
    const secret = new TextEncoder().encode(key);

    const user = findUser(username);
    if (!user) {
        return { ok: false, error: 'Usuario no encontrado o inactivo' };
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
        return { ok: false, error: 'Contraseña incorrecta' };
    }

    const token = await new SignJWT({
        role:       user.role,
        department: user.department,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.username)
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(secret);

    const principal: Principal = {
        id:         user.username,
        role:       user.role,
        department: user.department,
    };

    return { ok: true, token, user: principal };
}
