import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canManageUsers } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user || !canManageUsers(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { role?: UserRole; active?: boolean };

    const allowed = ['role', 'active'] as const;
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
        if (key in body) update[key] = body[key];
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    await db.update(schema.users).set(update).where(eq(schema.users.id, params.id));

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, params.id) });
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { passwordHash: _, ...safe } = user;
    return NextResponse.json({ user: safe });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user || !canManageUsers(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (session.user.id === params.id) {
        return NextResponse.json({ error: 'No podés eliminar tu propio usuario' }, { status: 400 });
    }

    await db.delete(schema.users).where(eq(schema.users.id, params.id));
    return NextResponse.json({ ok: true });
}
