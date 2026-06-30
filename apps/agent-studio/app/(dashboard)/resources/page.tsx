import type { DepartmentResource } from '@/lib/abac';
import { listDepartmentResources } from '@/lib/abac';
import { ResourcesTable } from '@/components/resources/ResourcesTable';
import { ShieldCheck } from 'lucide-react';

export default async function ResourcesPage() {
    let resources: DepartmentResource[] = [];
    let error: string | null = null;

    try {
        resources = await listDepartmentResources();
    } catch (e) {
        error = e instanceof Error ? e.message : 'No se pudo conectar con abac-service';
    }

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-foreground">MCP Resources</h1>
                    <p className="text-sm text-muted-foreground">
                        URI patterns permitidos por department — techo de acceso a context pre-cargado.
                    </p>
                </div>
            </div>

            {/* Conceptual summary */}
            <div className="rounded-lg border border-border bg-muted/20 px-5 py-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Cada usuario hereda los patterns del department al que pertenece.
                    Un{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">vault_resources</code>
                    {' '}personal solo puede reducir el conjunto, nunca ampliarlo.
                    Los hosts MCP (Claude Desktop, Cursor, Cline) filtran{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">resources/list</code>
                    {' '}y validan{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">resources/read</code>
                    {' '}contra estos patterns en tiempo real.
                </p>
            </div>

            {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4">
                    <p className="text-sm text-destructive">
                        Error: {error}. Verificá que abac-service esté corriendo en :3005.
                    </p>
                </div>
            ) : (
                <ResourcesTable initialResources={resources} />
            )}
        </div>
    );
}
