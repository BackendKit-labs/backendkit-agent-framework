/**
 * Migra usuarios desde ~/.backendkit/auth/users.json al SQLite enterprise.db.
 * Se llama automáticamente en el primer arranque si la tabla está vacía.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index';
import { users } from '../db/schema';

interface LegacyUser {
    id:           string;
    username:     string;
    name?:        string;
    role:         string;
    department?:  string;
    passwordHash: string;
    active:       boolean;
    createdAt:    string;
}

export async function migrateFromJson(): Promise<number> {
    const jsonPath = process.env['CONFIG_AUTH_DIR']
        ? path.join(process.env['CONFIG_AUTH_DIR'], 'users.json')
        : path.join(os.homedir(), '.backendkit', 'auth', 'users.json');

    if (!fs.existsSync(jsonPath)) return 0;

    let legacy: LegacyUser[] = [];
    try { legacy = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as LegacyUser[]; }
    catch { return 0; }

    let migrated = 0;
    const now = new Date().toISOString();

    for (const u of legacy) {
        try {
            await db.insert(users).values({
                id:           u.id ?? randomUUID(),
                username:     u.username,
                name:         u.name,
                role:         u.role,
                department:   u.department,
                passwordHash: u.passwordHash,
                active:       u.active,
                failedAttempts: 0,
                canUseDirector: true,
                canUseVault:    false,
                createdAt:    u.createdAt ?? now,
                updatedAt:    now,
            }).onConflictDoNothing();
            migrated++;
        } catch { /* skip duplicates */ }
    }

    if (migrated > 0) {
        process.stderr.write(`[auth-service] Migrated ${migrated} users from users.json\n`);
    }
    return migrated;
}

// El setup inicial del primer admin se hace via /setup (endpoint de un solo uso)
