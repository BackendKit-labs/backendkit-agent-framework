import { jwtVerify, importSPKI } from 'jose';
import type { Principal } from './types.js';

function toSpkiPem(base64RawKey: string): string {
    const prefix = Buffer.from('302a300506032b6570032100', 'hex');
    const rawKey = Buffer.from(base64RawKey, 'base64');
    if (rawKey.length !== 32) {
        throw new Error(`ABAC_PUBLIC_KEY debe ser Ed25519 de 32 bytes (recibidos: ${rawKey.length})`);
    }
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([prefix, rawKey]).toString('base64')}\n-----END PUBLIC KEY-----`;
}

async function getPublicKey() {
    const raw = process.env['ABAC_PUBLIC_KEY'];
    if (!raw) throw new Error('ABAC_PUBLIC_KEY no configurado');
    return importSPKI(toSpkiPem(raw), 'EdDSA');
}

/** true cuando el modo empresa está activo (ABAC_PUBLIC_KEY seteado). */
export const isEnterpriseMode = (): boolean => !!process.env['ABAC_PUBLIC_KEY'];

/** Verifica un JWT EdDSA emitido por abac-service y extrae el Principal. */
export async function verifyToken(token: string): Promise<Principal> {
    const key = await getPublicKey();
    try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'] });
        if (!payload.sub) throw new Error('Token sin sub');
        const roles: string[] = Array.isArray(payload['roles']) ? payload['roles'] as string[] : [];
        return {
            id:          payload.sub,
            email:       typeof payload['email']   === 'string' ? payload['email']   : undefined,
            org:         typeof payload['org']     === 'string' ? payload['org']     : null,
            orgSlug:     typeof payload['orgSlug'] === 'string' ? payload['orgSlug'] : null,
            roles,
            permissions: Array.isArray(payload['permissions']) ? payload['permissions'] as string[] : [],
            role:        roles[0] ?? 'viewer',
            // abac emite department: null cuando no está asignado — null no es
            // string, así que cae a undefined y las condiciones ABAC por
            // department simplemente no matchean (antes evaluaban contra '').
            department:  typeof payload['department'] === 'string' ? payload['department'] : undefined,
            // vaultResources: null = "hereda el ceiling del department" → se
            // mapea a undefined para que VaultFilter use los paths por rol;
            // un array = override personal de prefijos de vault.
            vault:       Array.isArray(payload['vaultResources']) ? payload['vaultResources'] as string[] : undefined,
        };
    } catch (cause) {
        throw new Error(`Token inválido: ${(cause as Error).message}`);
    }
}
