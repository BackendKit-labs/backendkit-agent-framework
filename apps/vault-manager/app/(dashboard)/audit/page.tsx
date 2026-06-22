import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { Topbar } from '@/components/layout/topbar';
import { AuditTable } from '@/components/audit/audit-table';
import { canAudit, canAccessVault } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import type { UserRole } from '@/lib/permissions';

export const metadata = { title: 'Auditoría' };

export default async function AuditPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (!canAudit(session.user.role as UserRole)) redirect('/');

    const vaults = await db.select().from(schema.vaultDefinitions).where(eq(schema.vaultDefinitions.active, true));
    const allowedVaults = vaults.filter(v => canAccessVault(session.user.role as UserRole, v.ownerRole as 'admin' | 'technical' | 'business'));
    const allowedVaultIds = allowedVaults.map(v => v.id);

    const items = allowedVaultIds.length > 0
        ? await db.select().from(schema.auditItems).orderBy(schema.auditItems.createdAt)
        : [];

    const filteredItems = items.filter(i => allowedVaultIds.includes(i.vaultId));

    const pendingCount  = filteredItems.filter(i => i.status === 'pending').length;
    const approvedCount = filteredItems.filter(i => i.status === 'approved').length;
    const rejectedCount = filteredItems.filter(i => i.status === 'rejected').length;

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Cola de Auditoría"
                subtitle={`${pendingCount} pendientes · ${approvedCount} aprobadas · ${rejectedCount} rechazadas`}
                userName={session.user.name}
                userEmail={session.user.email}
                userRole={session.user.role}
            />
            <div className="flex-1 overflow-y-auto p-6">
                {/* Summary chips */}
                <div className="mb-6 flex gap-3">
                    {[
                        { label: 'Pendientes',  count: pendingCount,  color: 'border-amber-800/50 bg-amber-950/30 text-amber-400' },
                        { label: 'Aprobadas',   count: approvedCount, color: 'border-emerald-800/50 bg-emerald-950/30 text-emerald-400' },
                        { label: 'Rechazadas',  count: rejectedCount, color: 'border-red-800/50 bg-red-950/30 text-red-400' },
                        { label: 'Total',       count: filteredItems.length, color: 'border-border bg-muted/30 text-foreground' },
                    ].map(chip => (
                        <div key={chip.label} className={`flex items-center gap-2 rounded-lg border px-4 py-2 ${chip.color}`}>
                            <span className="text-xl font-bold tabular-nums">{chip.count}</span>
                            <span className="text-xs">{chip.label}</span>
                        </div>
                    ))}
                </div>

                <AuditTable items={filteredItems} vaults={allowedVaults} />
            </div>
        </div>
    );
}
