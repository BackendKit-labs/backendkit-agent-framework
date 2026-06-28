import { NextRequest, NextResponse } from 'next/server';
import { db }             from '@/db/index';
import { users }          from '@/db/schema';
import { eq }             from 'drizzle-orm';
import { adminFromRequest } from '@/lib/auth';
import { hashPassword }   from '@/lib/password';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const [user] = await db.select().from(users).where(eq(users.id, params.id));
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { passwordHash: _, ...pub } = user;
    return NextResponse.json(pub);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: {
        name?: string; email?: string; role?: string; department?: string;
        active?: boolean; password?: string;
        directorTools?: string[] | null; vaultNamespaces?: string[] | null;
        canUseDirector?: boolean; canUseVault?: boolean;
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido — se esperaba JSON' }, { status: 400 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name        !== undefined) update.name        = body.name;
    if (body.email       !== undefined) update.email       = body.email;
    if (body.role        !== undefined) update.role        = body.role;
    if (body.department  !== undefined) update.department  = body.department;
    if (body.active      !== undefined) update.active      = body.active;
    if (body.canUseDirector !== undefined) update.canUseDirector = body.canUseDirector;
    if (body.canUseVault    !== undefined) update.canUseVault    = body.canUseVault;
    if ('directorTools'  in body) update.directorTools   = body.directorTools  != null ? JSON.stringify(body.directorTools)  : null;
    if ('vaultNamespaces' in body) update.vaultNamespaces = body.vaultNamespaces != null ? JSON.stringify(body.vaultNamespaces) : null;
    if (body.password) {
        update.passwordHash    = await hashPassword(body.password);
        update.failedAttempts  = 0;
        update.lockedUntil     = null;
    }

    await db.update(users).set(update).where(eq(users.id, params.id));
    const [updated] = await db.select().from(users).where(eq(users.id, params.id));
    const { passwordHash: _, ...pub } = updated;
    return NextResponse.json(pub);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await db.update(users)
        .set({ active: false, updatedAt: new Date().toISOString() })
        .where(eq(users.id, params.id));
    return NextResponse.json({ ok: true });
}
