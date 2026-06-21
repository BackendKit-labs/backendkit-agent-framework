import { NextRequest, NextResponse } from 'next/server';
import { db }           from '@/db/index';
import { users }        from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { ensureSchema } from '@/db/ensure';
import { randomUUID }   from 'node:crypto';

/** Verifica si ya existe algún usuario — si hay usuarios, el setup está cerrado. */
export async function GET() {
    await ensureSchema();
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    return NextResponse.json({ setupRequired: existing.length === 0 });
}

/**
 * Crea el primer usuario admin. Solo funciona si la base está vacía.
 * Después del primer uso queda permanentemente deshabilitado (409).
 */
export async function POST(req: NextRequest) {
    await ensureSchema();

    // Verificar que no haya usuarios
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
        return NextResponse.json(
            { error: 'Setup ya completado. El sistema ya tiene usuarios registrados.' },
            { status: 409 },
        );
    }

    const { username, password, name } = await req.json() as {
        username: string;
        password: string;
        name?:    string;
    };

    if (!username || !password) {
        return NextResponse.json({ error: 'username y password son requeridos' }, { status: 400 });
    }
    if (password.length < 10) {
        return NextResponse.json({ error: 'La contraseña debe tener al menos 10 caracteres' }, { status: 400 });
    }

    const now = new Date().toISOString();
    await db.insert(users).values({
        id:             randomUUID(),
        username,
        name:           name ?? 'Administrador',
        role:           'admin',
        passwordHash:   await hashPassword(password),
        active:         true,
        failedAttempts: 0,
        canUseDirector: true,
        canUseVault:    true,
        createdAt:      now,
        updatedAt:      now,
    });

    return NextResponse.json({ ok: true, message: `Usuario "${username}" creado como admin.` }, { status: 201 });
}
