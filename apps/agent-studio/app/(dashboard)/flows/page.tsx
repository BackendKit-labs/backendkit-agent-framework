import type { Metadata } from 'next';
import { Topbar }      from '@/components/layout/topbar';
import { FlowsPanel }  from '@/components/flows/flows-panel';
import { getConfig }   from '@/lib/gateway';

export const metadata: Metadata = { title: 'Flows' };

export default async function FlowsPage() {
    const config   = await getConfig();
    const flows    = config?.flows    ?? [];
    const agentIds = (config?.agents  ?? []).map(a => a.id);

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Flows"
                subtitle={`${flows.length} flow${flows.length !== 1 ? 's' : ''} configured`}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <FlowsPanel flows={flows} agentIds={agentIds} />
            </div>
        </div>
    );
}
