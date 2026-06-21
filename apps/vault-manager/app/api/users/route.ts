import { NextResponse } from 'next/server';

// Los usuarios se gestionan en auth-service: http://localhost:4000/admin/users
// Esta ruta redirige para mantener compatibilidad con links existentes.
export async function GET() {
    return NextResponse.json(
        { message: 'Los usuarios se gestionan en el Auth Service.', url: `${process.env.AUTH_SERVICE_URL ?? 'http://localhost:4000'}/admin/users` },
        { status: 301 },
    );
}
