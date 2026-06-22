import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import type { UserRole } from '@/lib/permissions';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { path?: string; label?: string; description?: string; active?: boolean };

    const allowed = ['path', 'label', 'description', 'active'] as const;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
        if (key in body) update[key] = body[key];
    }

    await db.update(schema.vaultDefinitions).set(update).where(eq(schema.vaultDefinitions.id, params.id));

    const vault = await db.query.vaultDefinitions.findFirst({ where: eq(schema.vaultDefinitions.id, params.id) });
    return NextResponse.json({ vault });
}
