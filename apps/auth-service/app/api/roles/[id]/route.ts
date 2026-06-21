import { NextRequest, NextResponse } from 'next/server';
import { db }              from '@/db/index';
import { roles }           from '@/db/schema';
import { eq }              from 'drizzle-orm';
import { adminFromRequest } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const [role] = await db.select().from(roles).where(eq(roles.id, params.id));
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(role);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
        label?: string; description?: string; tools?: string[]; active?: boolean;
    };
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.label       !== undefined) update.label       = body.label.trim();
    if (body.description !== undefined) update.description = body.description?.trim() || null;
    if (body.tools       !== undefined) update.tools       = JSON.stringify(body.tools);
    if (body.active      !== undefined) update.active      = body.active;

    await db.update(roles).set(update).where(eq(roles.id, params.id));
    const [updated] = await db.select().from(roles).where(eq(roles.id, params.id));
    return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await db.update(roles)
        .set({ active: false, updatedAt: new Date().toISOString() })
        .where(eq(roles.id, params.id));
    return NextResponse.json({ ok: true });
}
