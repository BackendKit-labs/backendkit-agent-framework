/**
 * Lee el store de usuarios escrito por config-agent.
 * Ubicación compartida: ~/.backendkit/auth/users.json
 *
 * El director NO escribe en este archivo — eso lo hace config-agent vía su web UI.
 * El director solo verifica credenciales y emite JWTs.
 */

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const AUTH_DIR   = process.env['CONFIG_AUTH_DIR'] ?? path.join(os.homedir(), '.backendkit', 'auth');
const USERS_FILE = path.join(AUTH_DIR, 'users.json');

export interface StoredUser {
    id:           string;
    username:     string;
    name?:        string;
    role:         string;
    department?:  string;
    passwordHash: string;
    active:       boolean;
}

export function readUsers(): StoredUser[] {
    if (!existsSync(USERS_FILE)) return [];
    try { return JSON.parse(readFileSync(USERS_FILE, 'utf-8')) as StoredUser[]; }
    catch { return []; }
}

export function findUser(username: string): StoredUser | undefined {
    return readUsers().find(u => u.username === username && u.active);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    try {
        const [salt, hashHex] = stored.split(':');
        const hash       = await scryptAsync(password, salt!, 64) as Buffer;
        const storedHash = Buffer.from(hashHex!, 'hex');
        return timingSafeEqual(hash, storedHash);
    } catch { return false; }
}
