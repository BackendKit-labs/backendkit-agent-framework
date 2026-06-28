import { NextRequest, NextResponse } from 'next/server';
import { db }              from '@/db/index';
import { roles }           from '@/db/schema';
import { eq, asc }         from 'drizzle-orm';
import { adminFromRequest } from '@/lib/auth';
import { randomUUID }      from 'node:crypto';

export async function GET() {
    const all = await db.select().from(roles)
        .where(eq(roles.active, true))
        .orderBy(asc(roles.label));
    return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { name?: string; label?: string; description?: string; tools?: string[] };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido — se esperaba JSON' }, { status: 400 });
    }
    const { name, label, description, tools } = body;

    if (!name?.trim() || !label?.trim())
        return NextResponse.json({ error: 'name y label son requeridos' }, { status: 400 });

    const now = new Date().toISOString();
    try {
        const [role] = await db.insert(roles).values({
            id:          randomUUID(),
            name:        name.trim().toLowerCase().replace(/\s+/g, '-'),
            label:       label.trim(),
            description: description?.trim() || null,
            tools:       JSON.stringify(tools ?? []),
            active:      true,
            createdAt:   now,
            updatedAt:   now,
        }).returning();
        return NextResponse.json(role, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'El nombre de rol ya existe' }, { status: 409 });
    }
}
