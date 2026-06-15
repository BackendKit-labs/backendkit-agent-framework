import type { Metadata } from 'next';
import { Topbar }       from '@/components/layout/topbar';
import { AgentsPanel }  from '@/components/agents/agents-panel';
import { listAgents, getConfig } from '@/lib/gateway';

export const metadata: Metadata = { title: 'Agents' };

export default async function AgentsPage() {
    const [agents, config] = await Promise.all([listAgents(), getConfig()]);
    const agentConfigs = config?.agents ?? [];

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Agents"
                subtitle={`${agentConfigs.length} agent${agentConfigs.length !== 1 ? 's' : ''} configured`}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <AgentsPanel agents={agents} agentConfigs={agentConfigs} />
            </div>
        </div>
    );
}
