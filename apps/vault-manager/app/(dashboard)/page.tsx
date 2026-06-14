import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, gte, count } from 'drizzle-orm';
import { Topbar } from '@/components/layout/topbar';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { VaultHealth } from '@/components/dashboard/vault-health';
import { RecentActivity } from '@/components/dashboard/recent-activity';

async function getDashboardData() {
    const [totalNotes, pendingItems, approvedItems, vaultDefs, recentItems] = await Promise.all([
        db.select({ c: count() }).from(schema.auditItems).then(r => r[0]?.c ?? 0),
        db.select({ c: count() }).from(schema.auditItems).where(eq(schema.auditItems.status, 'pending')).then(r => r[0]?.c ?? 0),
        db.select({ c: count() }).from(schema.auditItems)
            .where(eq(schema.auditItems.status, 'approved'))
            .then(r => r[0]?.c ?? 0),
        db.select().from(schema.vaultDefinitions).where(eq(schema.vaultDefinitions.active, true)),
        db.select().from(schema.auditItems).orderBy(schema.auditItems.createdAt).limit(8),
    ]);

    const vaultStats = await Promise.all(vaultDefs.map(async (v) => {
        const [total, approved, pending] = await Promise.all([
            db.select({ c: count() }).from(schema.auditItems).where(eq(schema.auditItems.vaultId, v.id)).then(r => r[0]?.c ?? 0),
            db.select({ c: count() }).from(schema.auditItems).where(eq(schema.auditItems.vaultId, v.id)).then(r => r[0]?.c ?? 0),
            db.select({ c: count() }).from(schema.auditItems)
                .where(eq(schema.auditItems.status, 'pending'))
                .then(r => r[0]?.c ?? 0),
        ]);
        return { id: v.id, label: v.label, ownerRole: v.ownerRole, totalNotes: total, approved, pending };
    }));

    // Generate 14 days of activity data (demo data when DB empty)
    const days = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return {
            date:      d.toLocaleDateString('es', { day: '2-digit', month: 'short' }),
            ingestas:  Math.floor(Math.random() * 8),
            aprobadas: Math.floor(Math.random() * 6),
            mejoradas: Math.floor(Math.random() * 3),
        };
    });

    return { totalNotes, pendingItems, approvedItems, vaultDefs, vaultStats, recentItems, activityData: days };
}

export default async function DashboardPage() {
    const session = await auth();
    const data    = await getDashboardData();

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Dashboard"
                subtitle="Resumen del sistema de vaults"
                userName={session?.user.name}
                userEmail={session?.user.email}
                userRole={session?.user.role}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <StatsCards
                    totalNotes={data.totalNotes}
                    pendingAudit={data.pendingItems}
                    approvedWeek={data.approvedItems}
                    activeVaults={data.vaultDefs.length}
                />

                <div className="grid grid-cols-3 gap-6">
                    <div className="col-span-2">
                        <ActivityChart data={data.activityData} />
                    </div>
                    <div className="col-span-1">
                        <VaultHealth vaults={data.vaultStats} />
                    </div>
                </div>

                <RecentActivity items={data.recentItems} />
            </div>
        </div>
    );
}
