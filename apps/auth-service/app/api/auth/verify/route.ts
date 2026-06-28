import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
    let body: { token?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido — se esperaba JSON con token' }, { status: 400 });
    }
    const { token } = body;
    if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 });
    try {
        const payload = await verifyToken(token);
        return NextResponse.json({ valid: true, user: payload });
    } catch (e) {
        return NextResponse.json({ valid: false, error: (e as Error).message }, { status: 401 });
    }
}
