import { NextRequest, NextResponse } from 'next/server';
import { db }               from '@/db/index';
import { departments }      from '@/db/schema';
import { eq, asc }          from 'drizzle-orm';
import { adminFromRequest }  from '@/lib/auth';
import { randomUUID }       from 'node:crypto';

export async function GET(req: NextRequest) {
    // GET es público — los formularios de usuario lo necesitan sin ser admin
    const all = await db.select().from(departments)
        .where(eq(departments.active, true))
        .orderBy(asc(departments.name));
    return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
    if (!await adminFromRequest(req))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, description } = await req.json() as { name: string; description?: string };
    if (!name?.trim())
        return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 });

    try {
        const [dept] = await db.insert(departments).values({
            id:          randomUUID(),
            name:        name.trim(),
            description: description?.trim() || null,
            active:      true,
            createdAt:   new Date().toISOString(),
        }).returning();
        return NextResponse.json(dept, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'El departamento ya existe' }, { status: 409 });
    }
}
