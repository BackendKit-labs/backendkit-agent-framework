import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canAccessVault, canManageUsers } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

export async function GET() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const vaults = await db.select().from(schema.vaultDefinitions).where(eq(schema.vaultDefinitions.active, true));
    const allowed = vaults.filter(v => canAccessVault(session.user.role as UserRole, v.ownerRole as 'admin' | 'technical' | 'business'));
    return NextResponse.json({ vaults: allowed });
}

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user || !canManageUsers(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const vault = { id: crypto.randomUUID(), ...body };
    await db.insert(schema.vaultDefinitions).values(vault);
    return NextResponse.json({ vault });
}
