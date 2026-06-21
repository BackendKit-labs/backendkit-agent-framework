import { NextResponse } from 'next/server';

// Los usuarios se gestionan en auth-service.
export async function PATCH() {
    return NextResponse.json({ message: 'Usá el Auth Service para gestionar usuarios.' }, { status: 301 });
}

export async function DELETE() {
    return NextResponse.json({ message: 'Usá el Auth Service para gestionar usuarios.' }, { status: 301 });
}
