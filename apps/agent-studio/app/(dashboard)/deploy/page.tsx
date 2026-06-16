import type { Metadata } from 'next';
import { Topbar }       from '@/components/layout/topbar';
import { DeployPanel }  from '@/components/deploy/deploy-panel';
import { listDeployments } from '@/lib/gateway';

export const metadata: Metadata = { title: 'Deploy' };

export default async function DeployPage() {
    const instances = await listDeployments();
    const running   = instances.filter(i => i.status === 'running').length;

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar
                title="Deploy"
                subtitle={`${running} container${running !== 1 ? 's' : ''} running`}
            />
            <div className="flex-1 overflow-y-auto p-6">
                <DeployPanel initial={instances} />
            </div>
        </div>
    );
}
