import { db } from './index';
import { sql } from 'drizzle-orm';
import { departments } from './schema';
import { randomUUID } from 'node:crypto';

/** Crea las tablas si no existen (bootstrap sin drizzle-kit en runtime) */
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

    await db.run(sql`
        CREATE TABLE IF NOT EXISTS departments (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            description TEXT,
            active      INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL
        )
    `);

    await seedDefaultDepartments();
}

const DEFAULT_DEPARTMENTS = [
    { name: 'Ingeniería',        description: 'Desarrollo de software y arquitectura' },
    { name: 'Operaciones',       description: 'DevOps, infraestructura y plataforma' },
    { name: 'Recursos Humanos',  description: 'Gestión de personas y onboarding' },
    { name: 'Ventas',            description: 'Comercial y relaciones con clientes' },
    { name: 'Finanzas',          description: 'Contabilidad, pagos y reportes financieros' },
    { name: 'Producto',          description: 'Diseño y gestión de producto' },
    { name: 'Soporte',           description: 'Atención al cliente y helpdesk' },
];

async function seedDefaultDepartments(): Promise<void> {
    const existing = await db.select({ id: departments.id }).from(departments).limit(1);
    if (existing.length > 0) return;  // ya hay departamentos

    const now = new Date().toISOString();
    for (const d of DEFAULT_DEPARTMENTS) {
        await db.insert(departments).values({
            id:          randomUUID(),
            name:        d.name,
            description: d.description,
            active:      true,
            createdAt:   now,
        }).onConflictDoNothing();
    }
}
