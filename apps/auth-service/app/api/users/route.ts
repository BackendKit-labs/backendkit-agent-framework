import { NextRequest, NextResponse } from 'next/server';
import { db }             from '@/db/index';
import { users }          from '@/db/schema';
import { eq }             from 'drizzle-orm';
import { adminFromRequest } from '@/lib/auth';
import { hashPassword }   from '@/lib/password';
import { randomUUID }     from 'node:crypto';

export async function GET(req: NextRequest) {
    if (!await adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const all = await db.select({
        id: users.id, username: users.username, name: users.name, email: users.email,
        role: users.role, department: users.department, active: users.active,
        failedAttempts: users.failedAttempts, lockedUntil: users.lockedUntil,
        directorTools: users.directorTools, vaultNamespaces: users.vaultNamespaces,
        canUseDirector: users.canUseDirector, canUseVault: users.canUseVault,
        createdAt: users.createdAt, updatedAt: users.updatedAt,
    }).from(users);
    return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
    if (!await adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: {
        username: string; password: string; name?: string; email?: string;
        role: string; department?: string;
        directorTools?: string[] | null; vaultNamespaces?: string[] | null;
        canUseDirector?: boolean; canUseVault?: boolean;
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido — se esperaba JSON' }, { status: 400 });
    }

    if (!body.username || !body.password || !body.role) {
        return NextResponse.json({ error: 'username, password y role son requeridos' }, { status: 400 });
    }

    const now = new Date().toISOString();
    try {
        const [user] = await db.insert(users).values({
            id:              randomUUID(),
            username:        body.username,
            name:            body.name,
            email:           body.email,
            role:            body.role,
            department:      body.department,
            passwordHash:    await hashPassword(body.password),
            active:          true,
            failedAttempts:  0,
            directorTools:   body.directorTools ? JSON.stringify(body.directorTools) : null,
            vaultNamespaces: body.vaultNamespaces ? JSON.stringify(body.vaultNamespaces) : null,
            canUseDirector:  body.canUseDirector ?? true,
            canUseVault:     body.canUseVault ?? false,
            createdAt:       now,
            updatedAt:       now,
        }).returning({ id: users.id, username: users.username });
        return NextResponse.json(user, { status: 201 });
    } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg.includes('UNIQUE')) return NextResponse.json({ error: 'El username ya existe' }, { status: 409 });
        throw e;
    }
}
