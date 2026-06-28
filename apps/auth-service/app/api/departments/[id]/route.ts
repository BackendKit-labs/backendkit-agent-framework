import { NextRequest, NextResponse } from 'next/server';
import { db }              from '@/db/index';
import { departments }     from '@/db/schema';
import { eq }              from 'drizzle-orm';
import { adminFromRequest } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { name?: string; description?: string; active?: boolean };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido — se esperaba JSON' }, { status: 400 });
    }
    const { name, description, active } = body;
    const update: Record<string, unknown> = {};
    if (name        !== undefined) update.name        = name.trim();
    if (description !== undefined) update.description = description?.trim() || null;
    if (active      !== undefined) update.active      = active;

    await db.update(departments).set(update).where(eq(departments.id, params.id));
    const [updated] = await db.select().from(departments).where(eq(departments.id, params.id));
    return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await db.update(departments)
        .set({ active: false })
        .where(eq(departments.id, params.id));
    return NextResponse.json({ ok: true });
}
