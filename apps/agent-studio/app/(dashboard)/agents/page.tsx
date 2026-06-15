import type { Metadata } from 'next';
import { Topbar }              from '@/components/layout/topbar';
import { AgentGrid }           from '@/components/agents/agent-health';
import { listAgents, getConfig } from '@/lib/gateway';

export const metadata: Metadata = { title: 'Agents' };

export default async function AgentsPage() {
    const [agents, config] = await Promise.all([listAgents(), getConfig()]);
    const agentConfigs = config?.agents ?? [];

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Agents"
                subtitle={`${agents.length} agent${agents.length !== 1 ? 's' : ''} registered`}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <AgentGrid agents={agents} agentConfigs={agentConfigs} />
            </div>
        </div>
    );
}
