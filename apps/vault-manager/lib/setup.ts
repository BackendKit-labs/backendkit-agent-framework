/**
 * Initial setup: creates default admin user and seed vault definitions.
 * Run once: npx tsx lib/setup.ts
 */
import 'dotenv/config';
import { db, schema } from '../db';
import { hashPassword } from './auth';
import { eq } from 'drizzle-orm';

async function setup() {
    console.log('Setting up Vault Manager...\n');

    // Create tables (SQLite — Drizzle migrate)
    // Run: npm run db:migrate first

    // Default admin
    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, 'admin@empresa.com') });
    if (!existing) {
        await db.insert(schema.users).values({
            id:           crypto.randomUUID(),
            email:        'admin@empresa.com',
            name:         'Administrador',
            passwordHash: hashPassword('admin123'),
            role:         'admin',
            active:       true,
        });
        console.log('✓ Admin user created: admin@empresa.com / admin123');
    } else {
        console.log('  Admin user already exists.');
    }

    // Default vault definitions
    const vaultSeeds = [
        { id: 'vault-ai',           label: 'AI Engineering',        ownerRole: 'technical', description: 'Conocimiento de ML, deep learning, LLMs, RAG y agentes', icon: 'Brain',    path: process.env.AI_VAULT_PATH      ?? '' },
        { id: 'vault-typescript',   label: 'TypeScript Patterns',   ownerRole: 'technical', description: 'Patrones TypeScript, Node.js y frameworks',              icon: 'Code',     path: process.env.TS_VAULT_PATH      ?? '' },
        { id: 'vault-architecture', label: 'Architecture Patterns', ownerRole: 'technical', description: 'System design, microservicios y DDD',                    icon: 'Layers',   path: process.env.ARCH_VAULT_PATH    ?? '' },
        { id: 'vault-empresa',      label: 'Empresa',               ownerRole: 'business',  description: 'Procesos, normas y lógica de negocio de la empresa',      icon: 'Building', path: process.env.COMPANY_VAULT_PATH ?? '' },
    ] as const;

    for (const v of vaultSeeds) {
        const ex = await db.query.vaultDefinitions.findFirst({ where: eq(schema.vaultDefinitions.id, v.id) });
        if (!ex) {
            await db.insert(schema.vaultDefinitions).values({ ...v, active: true, noteCount: 0 });
            console.log(`✓ Vault created: ${v.label} (${v.ownerRole})`);
        }
    }

    console.log('\nSetup complete. Run: npm run dev\n');
    process.exit(0);
}

setup().catch(err => { console.error(err); process.exit(1); });
