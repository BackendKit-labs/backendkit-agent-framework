import { NextRequest, NextResponse } from 'next/server';
import { db }             from '@/db/index';
import { users }          from '@/db/schema';
import { eq, or }         from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { signToken }      from '@/lib/auth';
import { migrateFromJson } from '@/lib/migrate';
import { ensureSchema }   from '@/db/ensure';

let initialized = false;

async function init() {
    if (initialized) return;
    initialized = true;
    await ensureSchema();
    const count = await db.select().from(users).limit(1);
    if (count.length === 0) await migrateFromJson();
}

export async function POST(req: NextRequest) {
    await init();
    const { username, password } = await req.json() as { username: string; password: string };

    if (!username || !password) {
        return NextResponse.json({ error: 'username y password requeridos' }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(
        or(eq(users.username, username), eq(users.email, username)),
    );

    if (!user) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 401 });
    }

    if (!user.active) {
        return NextResponse.json({ error: 'Usuario inactivo' }, { status: 403 });
    }

    // Bloqueo temporal por intentos fallidos
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const secs = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000);
        return NextResponse.json({ error: `Cuenta bloqueada. Intentá en ${secs}s` }, { status: 429 });
    }

    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
        const attempts = user.failedAttempts + 1;
        const lockedUntil = attempts >= 5
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString()  // 5 min
            : null;
        await db.update(users)
            .set({ failedAttempts: attempts, lockedUntil, updatedAt: new Date().toISOString() })
            .where(eq(users.id, user.id));
        return NextResponse.json({
            error: attempts >= 5
                ? 'Demasiados intentos — cuenta bloqueada 5 minutos'
                : `Contraseña incorrecta (${attempts}/5)`,
        }, { status: 401 });
    }

    // Reset failed attempts on success
    await db.update(users)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
        .where(eq(users.id, user.id));

    const token = await signToken(user);
    const { passwordHash: _, ...publicUser } = user;

    return NextResponse.json({ token, user: publicUser });
}
