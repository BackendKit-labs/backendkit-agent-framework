import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { UsersTable } from '@/components/users/users-table';
import { canManageUsers } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

export const metadata = { title: 'Usuarios' };

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4000';

type AuthUser = {
    id: string; username: string; name: string | null; email: string | null;
    role: string; active: boolean; createdAt: string;
};

export default async function UsersPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (!canManageUsers(session.user.role as UserRole)) redirect('/');

    let users: (AuthUser & { lastActiveAt: null })[] = [];
    try {
        const res = await fetch(`${AUTH_SERVICE_URL}/api/users`, {
            headers: { Authorization: `Bearer ${session.user.authToken}` },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        });
        if (res.ok) {
            const data = await res.json() as AuthUser[];
            users = data.map(u => ({ ...u, lastActiveAt: null }));
        }
    } catch { /* auth-service unreachable — show empty list */ }

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Gestión de Usuarios"
                subtitle={`${users.filter(u => u.active).length} activos · ${users.length} total`}
                userName={session.user.name}
                userEmail={session.user.email}
                userRole={session.user.role}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <UsersTable users={users} />
            </div>
        </div>
    );
}
