import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { User } from '../db/schema.js';

function getSecret(): Uint8Array {
    const key = process.env['AUTH_SECRET'];
    if (!key) throw new Error('AUTH_SECRET no configurado');
    return new TextEncoder().encode(key);
}

export interface TokenPayload extends JWTPayload {
    sub:   string;          // username
    role:  string;
    dept?: string;
    tools?: string[];       // workspace del Director (null = usar defaults del rol)
    vault?: string[];       // namespaces del vault (null = usar defaults del rol)
    apps:  string[];        // ['director', 'vault-manager']
}

export async function signToken(user: User): Promise<string> {
    const apps: string[] = [];
    if (user.canUseDirector) apps.push('director');
    if (user.canUseVault)    apps.push('vault-manager');

    const payload: Record<string, unknown> = {
        role: user.role,
        apps,
    };
    if (user.department)      payload.dept  = user.department;
    if (user.directorTools)   payload.tools = JSON.parse(user.directorTools) as string[];
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

/** Middleware helper: extrae y verifica el token del header Authorization */
export async function adminFromRequest(req: Request): Promise<TokenPayload | null> {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    try {
        const payload = await verifyToken(auth.slice(7));
        return payload.role === 'admin' ? payload : null;
    } catch { return null; }
}
