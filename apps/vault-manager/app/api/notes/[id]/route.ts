import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canAudit, canAccessVault } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const item = await db.query.auditItems.findFirst({ where: eq(schema.auditItems.id, params.id) });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const vault = await db.query.vaultDefinitions.findFirst({ where: eq(schema.vaultDefinitions.id, item.vaultId) });
    if (vault && !canAccessVault(session.user.role as UserRole, vault.ownerRole as 'admin' | 'technical' | 'business')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ item, vault });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user || !canAudit(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { action: string; feedback?: string; content?: string };
    const { action, feedback, content } = body;

    const item = await db.query.auditItems.findFirst({ where: eq(schema.auditItems.id, params.id) });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'approve') {
        await db.update(schema.auditItems)
            .set({ status: 'approved', reviewedBy: session.user.id, reviewedAt: new Date(), feedback: feedback ?? null })
            .where(eq(schema.auditItems.id, params.id));
    } else if (action === 'reject') {
        await db.update(schema.auditItems)
            .set({ status: 'rejected', reviewedBy: session.user.id, reviewedAt: new Date(), feedback: feedback ?? null })
            .where(eq(schema.auditItems.id, params.id));
    } else if (action === 'edit' && content) {
        await db.update(schema.auditItems)
            .set({ generatedContent: content })
            .where(eq(schema.auditItems.id, params.id));

        await db.insert(schema.vaultHistory).values({
            id:              crypto.randomUUID(),
            vaultId:         item.vaultId,
            notePath:        item.generatedTitle,
            previousContent: item.generatedContent,
            newContent:      content,
            changedBy:       session.user.id,
            changeType:      'edit',
        });
    } else if (action === 'improve') {
        await db.update(schema.auditItems)
            .set({ status: 'improved' })
            .where(eq(schema.auditItems.id, params.id));
    }

    return NextResponse.json({ ok: true });
}
