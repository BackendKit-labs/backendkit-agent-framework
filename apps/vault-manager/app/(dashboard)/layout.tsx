import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { db } from '@/db';
import { schema } from '@/db';
import { eq, and } from 'drizzle-orm';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect('/login');

    const pendingCount = await db
        .select({ id: schema.auditItems.id })
        .from(schema.auditItems)
        .where(eq(schema.auditItems.status, 'pending'))
        .then((rows) => rows.length)
        .catch(() => 0);

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar userRole={session.user.role} pendingCount={pendingCount} />
            <main className="flex flex-1 flex-col overflow-hidden">
                {children}
            </main>
        </div>
    );
}
