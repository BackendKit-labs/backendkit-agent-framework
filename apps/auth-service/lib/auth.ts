import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { User } from '../db/schema';
import { db }    from '../db/index';
import { roles } from '../db/schema';
import { eq }    from 'drizzle-orm';

function getSecret(): Uint8Array {
    const key = process.env['AUTH_SECRET'];
    if (!key) throw new Error('AUTH_SECRET no configurado');
    return new TextEncoder().encode(key);
}

export interface TokenPayload extends JWTPayload {
    sub:   string;
    role:  string;
    dept?: string;
    tools?: string[];
    vault?: string[];
    apps:  string[];
}

export async function signToken(user: User): Promise<string> {
    const apps: string[] = [];
    if (user.canUseDirector) apps.push('director');
    if (user.canUseVault)    apps.push('vault-manager');

    // Tools: si el usuario tiene workspace custom lo usa; si no, lee las tools del rol en la DB
    let tools: string[] | undefined;
    if (user.directorTools) {
        tools = JSON.parse(user.directorTools) as string[];
    } else {
        const [role] = await db.select({ tools: roles.tools }).from(roles).where(eq(roles.name, user.role));
        if (role) tools = JSON.parse(role.tools) as string[];
    }

    const payload: Record<string, unknown> = { role: user.role, apps };
    if (user.department)      payload.dept  = user.department;
    if (tools?.length)        payload.tools = tools;
    if (user.vaultNamespaces) payload.vault = JSON.parse(user.vaultNamespaces) as string[];

    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.username)
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(getSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload> {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    return payload as TokenPayload;
}

export async function adminFromRequest(req: Request): Promise<TokenPayload | null> {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    try {
        const payload = await verifyToken(auth.slice(7));
        return payload.role === 'admin' ? payload : null;
    } catch { return null; }
}
