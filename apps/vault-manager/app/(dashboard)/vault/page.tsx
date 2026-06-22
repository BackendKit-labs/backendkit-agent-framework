import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { Topbar } from '@/components/layout/topbar';
import { VaultBrowser } from '@/components/vault/vault-browser';
import type { UserRole } from '@/lib/permissions';
import { canAccessVault } from '@/lib/permissions';

export const metadata = { title: 'Vaults' };

export default async function VaultPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');

    const vaults = await db.select().from(schema.vaultDefinitions).where(eq(schema.vaultDefinitions.active, true));
    const allowed = vaults.filter(v => canAccessVault(session.user.role as UserRole, v.ownerRole as 'admin' | 'technical' | 'business'));

    const notes = allowed.length > 0
        ? await db.select().from(schema.auditItems)
            .where(eq(schema.auditItems.status, 'approved'))
            .orderBy(schema.auditItems.createdAt)
        : [];

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Vault Browser"
                subtitle={`${notes.length} notas aprobadas en ${allowed.length} vault${allowed.length !== 1 ? 's' : ''}`}
                userName={session.user.name}
                userEmail={session.user.email}
                userRole={session.user.role}
            />
            <VaultBrowser vaults={allowed} notes={notes} userRole={session.user.role} />
        </div>
    );
}
