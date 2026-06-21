import { db } from './index';
import { sql } from 'drizzle-orm';

/** Crea la tabla si no existe (bootstrap sin drizzle-kit en runtime) */
export async function ensureSchema(): Promise<void> {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS users (
            id               TEXT PRIMARY KEY,
            username         TEXT NOT NULL UNIQUE,
            name             TEXT,
            email            TEXT,
            role             TEXT NOT NULL DEFAULT 'viewer',
            department       TEXT,
            password_hash    TEXT NOT NULL,
            active           INTEGER NOT NULL DEFAULT 1,
            failed_attempts  INTEGER NOT NULL DEFAULT 0,
            locked_until     TEXT,
            director_tools   TEXT,
            vault_namespaces TEXT,
            can_use_director INTEGER NOT NULL DEFAULT 1,
            can_use_vault    INTEGER NOT NULL DEFAULT 0,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        )
    `);
}
