import { db } from './index';
import { sql, eq } from 'drizzle-orm';
import { departments, roles } from './schema';
import { randomUUID } from 'node:crypto';
import { DIRECTOR_TOOL_GROUPS, ROLE_DEFAULT_TOOLS } from '../lib/tools';

export async function ensureSchema(): Promise<void> {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS roles (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            label       TEXT NOT NULL,
            description TEXT,
            tools       TEXT NOT NULL DEFAULT '[]',
            active      INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
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

    await seedRoles();
    await syncAdminTools();
    await seedDepartments();
}

// ── Invariante: admin = acceso total ───────────────────────────────────────────
// seedRoles() solo siembra si la tabla está vacía, así que el rol admin persistido
// quedaría con un catálogo viejo cuando se agregan tools nuevas (p. ej. project_*,
// orchestrator_design/sdd, list_runs). Acá forzamos admin = ALL_TOOLS en cada
// arranque (idempotente). No tocamos roles no-admin: son subsets curados.
async function syncAdminTools(): Promise<void> {
    const tools = JSON.stringify(ROLE_DEFAULT_TOOLS['admin'] ?? []);
    await db.update(roles)
        .set({ tools, updatedAt: new Date().toISOString() })
        .where(eq(roles.name, 'admin'));
}

// ── Roles por defecto ──────────────────────────────────────────────────────────

const DEFAULT_ROLES: { name: string; label: string; description: string }[] = [
    { name: 'admin',       label: 'Administrador',   description: 'Acceso total al ecosistema' },
    { name: 'development', label: 'Desarrollador',   description: 'Diseño conversacional y flujos SDD (Coder v2)' },
    { name: 'devops',      label: 'DevOps',          description: 'Infraestructura, deploy y monitoreo' },
    { name: 'hr',          label: 'RR.HH.',          description: 'Flows de RR.HH. y onboarding' },
    { name: 'sales',       label: 'Ventas',          description: 'Flows de ventas y CRM' },
    { name: 'finance',     label: 'Finanzas',        description: 'Flows financieros y reportes' },
    { name: 'viewer',      label: 'Solo lectura',    description: 'Búsqueda en vault únicamente' },
];

async function seedRoles(): Promise<void> {
    const existing = await db.select({ id: roles.id }).from(roles).limit(1);
    if (existing.length > 0) return;

    const now = new Date().toISOString();
    for (const r of DEFAULT_ROLES) {
        const tools = ROLE_DEFAULT_TOOLS[r.name] ?? [];
        await db.insert(roles).values({
            id:          randomUUID(),
            name:        r.name,
            label:       r.label,
            description: r.description,
            tools:       JSON.stringify(tools),
            active:      true,
            createdAt:   now,
            updatedAt:   now,
        }).onConflictDoNothing();
    }
}

// ── Departamentos por defecto ─────────────────────────────────────────────────

const DEFAULT_DEPARTMENTS = [
    { name: 'Ingeniería',       description: 'Desarrollo de software y arquitectura' },
    { name: 'Operaciones',      description: 'DevOps, infraestructura y plataforma' },
    { name: 'Recursos Humanos', description: 'Gestión de personas y onboarding' },
    { name: 'Ventas',           description: 'Comercial y relaciones con clientes' },
    { name: 'Finanzas',         description: 'Contabilidad, pagos y reportes financieros' },
    { name: 'Producto',         description: 'Diseño y gestión de producto' },
    { name: 'Soporte',          description: 'Atención al cliente y helpdesk' },
];

async function seedDepartments(): Promise<void> {
    const existing = await db.select({ id: departments.id }).from(departments).limit(1);
    if (existing.length > 0) return;

    const now = new Date().toISOString();
    for (const d of DEFAULT_DEPARTMENTS) {
        await db.insert(departments).values({
            id: randomUUID(), name: d.name, description: d.description,
            active: true, createdAt: now,
        }).onConflictDoNothing();
    }
}
