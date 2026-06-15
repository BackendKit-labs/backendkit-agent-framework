import type { Metadata } from 'next';
import { Topbar }       from '@/components/layout/topbar';
import { KanbanBoard }  from '@/components/kanban/kanban-board';

export const metadata: Metadata = { title: 'Runs' };

export default function RunsPage() {
    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Runs"
                subtitle="Real-time orchestrator run monitor — refreshes every 3 s"
            />
            <div className="flex-1 overflow-hidden">
                <KanbanBoard />
            </div>
        </div>
    );
}
