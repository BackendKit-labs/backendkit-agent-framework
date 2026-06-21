/**
 * Migración manual: elimina tabla users y quita FKs hacia ella.
 * Ejecutar una sola vez: node scripts/migrate-remove-users.mjs
 */
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_URL?.replace('file:', '')
    ?? join(__dirname, '..', 'data', 'vault-manager.db');

if (!existsSync(dbPath)) {
    console.log('DB no existe aún — no es necesario migrar.');
    process.exit(0);
}

const client = createClient({ url: `file:${dbPath}` });

// Verificar si la tabla users existe
const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
if (tables.rows.length === 0) {
    console.log('✓ Tabla users no existe — migración ya aplicada o no necesaria.');
    process.exit(0);
}

console.log('Aplicando migración: eliminar tabla users y FKs relacionadas...\n');

async function run(sql) {
    process.stdout.write(`  ${sql.slice(0, 80).replace(/\n/g,' ')}...\n`);
    await client.execute(sql);
}

await run('PRAGMA foreign_keys = OFF');

// ── audit_items ───────────────────────────────────────────────────────────────
await run(`CREATE TABLE audit_items_new (
    id TEXT PRIMARY KEY NOT NULL,
    vault_id TEXT NOT NULL,
    source_file_name TEXT NOT NULL,
    source_text TEXT NOT NULL,
    generated_content TEXT NOT NULL,
    generated_title TEXT NOT NULL,
    area TEXT,
    tags TEXT,
    curator_score REAL,
    status TEXT DEFAULT 'pending' NOT NULL,
    feedback TEXT,
    reviewed_by TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (vault_id) REFERENCES vault_definitions(id) ON UPDATE no action ON DELETE no action
)`);
await run('INSERT INTO audit_items_new SELECT * FROM audit_items');
await run('DROP TABLE audit_items');
await run('ALTER TABLE audit_items_new RENAME TO audit_items');

// ── vault_history ─────────────────────────────────────────────────────────────
await run(`CREATE TABLE vault_history_new (
    id TEXT PRIMARY KEY NOT NULL,
    vault_id TEXT NOT NULL,
    note_path TEXT NOT NULL,
    previous_content TEXT,
    new_content TEXT NOT NULL,
    changed_by TEXT,
    change_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (vault_id) REFERENCES vault_definitions(id) ON UPDATE no action ON DELETE no action
)`);
await run('INSERT INTO vault_history_new SELECT * FROM vault_history');
await run('DROP TABLE vault_history');
await run('ALTER TABLE vault_history_new RENAME TO vault_history');

// ── ingest_jobs ───────────────────────────────────────────────────────────────
await run(`CREATE TABLE ingest_jobs_new (
    id TEXT PRIMARY KEY NOT NULL,
    vault_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    area_hint TEXT,
    status TEXT DEFAULT 'queued' NOT NULL,
    error TEXT,
    audit_item_id TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    FOREIGN KEY (vault_id)      REFERENCES vault_definitions(id) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (audit_item_id) REFERENCES audit_items(id)       ON UPDATE no action ON DELETE no action
)`);
await run('INSERT INTO ingest_jobs_new SELECT * FROM ingest_jobs');
await run('DROP TABLE ingest_jobs');
await run('ALTER TABLE ingest_jobs_new RENAME TO ingest_jobs');

// ── improve_sessions ──────────────────────────────────────────────────────────
await run(`CREATE TABLE improve_sessions_new (
    id TEXT PRIMARY KEY NOT NULL,
    audit_item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    messages TEXT DEFAULT '[]' NOT NULL,
    applied_content TEXT,
    status TEXT DEFAULT 'open' NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (audit_item_id) REFERENCES audit_items(id) ON UPDATE no action ON DELETE no action
)`);
await run('INSERT INTO improve_sessions_new SELECT * FROM improve_sessions');
await run('DROP TABLE improve_sessions');
await run('ALTER TABLE improve_sessions_new RENAME TO improve_sessions');

// ── Drop users ────────────────────────────────────────────────────────────────
await run('DROP TABLE IF EXISTS users');

await run('PRAGMA foreign_keys = ON');

console.log('\n✓ Migración completada. Tabla users eliminada, FKs convertidas a texto.\n');
process.exit(0);
