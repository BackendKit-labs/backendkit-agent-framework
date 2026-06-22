import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, and } from 'drizzle-orm';
import { canAccessVault } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const vault = await db.query.vaultDefinitions.findFirst({
        where: eq(schema.vaultDefinitions.id, params.id),
    });
    if (!vault) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (!canAccessVault(session.user.role as UserRole, vault.ownerRole as 'admin' | 'technical' | 'business')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const notes = await db
        .select()
        .from(schema.auditItems)
        .where(and(
            eq(schema.auditItems.vaultId, params.id),
            eq(schema.auditItems.status, 'approved'),
        ))
        .orderBy(schema.auditItems.createdAt);

    return NextResponse.json(notes);
}
