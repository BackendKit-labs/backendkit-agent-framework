import { NextRequest, NextResponse } from 'next/server';
import { auth, hashPassword } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canManageUsers } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

export async function GET() {
    const session = await auth();
    if (!session?.user || !canManageUsers(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const users = await db.select({
        id: schema.users.id, email: schema.users.email, name: schema.users.name,
        role: schema.users.role, active: schema.users.active,
        lastActiveAt: schema.users.lastActiveAt, createdAt: schema.users.createdAt,
    }).from(schema.users);
    return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user || !canManageUsers(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { name, email, role, password } = await req.json() as { name: string; email: string; role: UserRole; password: string };
    const user = {
        id: crypto.randomUUID(), name, email, role,
        passwordHash: hashPassword(password),
        active: true, createdAt: new Date(),
    };
    await db.insert(schema.users).values(user);
    const { passwordHash: _, ...safe } = user;
    return NextResponse.json({ user: safe });
}
