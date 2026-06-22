import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { Topbar } from '@/components/layout/topbar';
import { UploadZone } from '@/components/ingest/upload-zone';
import { canIngest } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

export const metadata = { title: 'Ingesta' };

export default async function IngestPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (!canIngest(session.user.role as UserRole)) redirect('/');

    const vaults = await db.select().from(schema.vaultDefinitions).where(eq(schema.vaultDefinitions.active, true));

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Ingesta de Documentos"
                subtitle="Procesá documentos con el curator AI para incorporarlos al vault"
                userName={session.user.name}
                userEmail={session.user.email}
                userRole={session.user.role}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-3xl">
                    {/* Info banner */}
                    <div className="mb-6 rounded-xl border border-indigo-800/50 bg-indigo-950/20 px-5 py-4">
                        <div className="flex gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
                                <span className="text-lg">🧠</span>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-indigo-300">Proceso de ingesta</p>
                                <p className="mt-0.5 text-xs text-indigo-400/80">
                                    El curator AI (DeepSeek R1) lee el documento, extrae el conocimiento relevante y genera
                                    una nota estructurada con tags, resumen y contenido. La nota va a la cola de auditoría
                                    para que un humano la revise antes de ser publicada al vault.
                                </p>
                            </div>
                        </div>
                    </div>

                    <UploadZone vaults={vaults} userRole={session.user.role} />
                </div>
            </div>
        </div>
    );
}
