import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { Topbar } from '@/components/layout/topbar';
import { UsersTable } from '@/components/users/users-table';
import { canManageUsers } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

export const metadata = { title: 'Usuarios' };

export default async function UsersPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (!canManageUsers(session.user.role as UserRole)) redirect('/');

    const users = await db.select({
        id:           schema.users.id,
        email:        schema.users.email,
        name:         schema.users.name,
        role:         schema.users.role,
        active:       schema.users.active,
        lastActiveAt: schema.users.lastActiveAt,
        createdAt:    schema.users.createdAt,
    }).from(schema.users).orderBy(schema.users.createdAt);

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
