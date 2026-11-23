/**
 * SPEC-0023 F4, the contract with Hermes: a handler built by core is the `flowHandler` of a real `AgentServer`, and a client that
 * speaks protocol 1.1 (what Hermes' `ProtocolConnector` is) lists, starts, watches, pauses, resumes and cancels its flows, and gets
 * the protocol codes. Core declares the shapes itself (it depends on no transport), so this test is what keeps them equal.
 */
import * as net from 'node:net';
import { AgentClient, AgentServer, type FlowHandler, type FlowRunState } from '@backendkit-labs/agent-protocol';
import { createFlowHandler, type FlowRunView, type InProcessFlow } from '..';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
    });
}
const until = async (check: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms;
    while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};

function closeMonth() {
    const ran: string[] = [];
    const waiting = new Map<string, () => void>();
    const hold = (name: string) => new Promise<void>(resolve => { waiting.set(name, resolve); });
    const flows: Record<string, InProcessFlow> = {
        'close-month': {
            description: 'collects and reports', steps: ['collect', 'report'],
            run: async (input, ctl) => {
                for (const name of ['collect', 'report']) { await ctl.step(name); ran.push(name); await hold(name); }
                return `closed ${String(input.month)}`;
            },
        },
    };
    return { flows, ran, release: (name: string) => { waiting.get(name)?.(); waiting.delete(name); } };
}

describe('a handler from core, served by a real AgentServer', () => {
    const stops: Array<() => Promise<unknown>> = [];
    afterEach(async () => { await Promise.all(stops.splice(0).map(s => s())); });

    async function serve() {
        const c = closeMonth();
        const { handler, host } = createFlowHandler(c.flows);
        // Compile time: core's shapes are assignable to the protocol's, both ways for what a supervisor reads.
        const asProtocol: FlowHandler = handler;
        const view: FlowRunView = {} as FlowRunState;
        void view;
        const port = await freePort();
        const server = new AgentServer({ allowUngated: true, name: 'books', version: '1.0.0', description: 'books', port, apiKey: 'run', controlApiKey: 'ctl', flowHandler: asProtocol });
        await server.start();
        stops.push(async () => { await host.close(); await server.stop(); });
        const url = `http://127.0.0.1:${port}`;
        return { ...c, url, client: new AgentClient({ url, apiKey: 'run', controlApiKey: 'ctl', maxRetries: 0 }) };
    }

    it('publishes its flows in info, and the client lists, starts, watches, pauses, resumes and cancels one', async () => {
        const a = await serve();
        const info = await (await fetch(`${a.url}/v1/agent/info`, { headers: { Authorization: 'Bearer run' } })).json() as { data: { flowControl?: boolean; flows?: Array<{ name: string }> } };
        expect(info.data).toMatchObject({ flowControl: true, flows: [{ name: 'close-month' }] });

        expect((await a.client.listFlows()).map(f => f.name)).toEqual(['close-month']);
        const { flowRunId } = await a.client.startFlow('close-month', { month: '2026-09' });
        await until(() => a.ran.includes('collect'));
        expect(await a.client.flowRun(flowRunId)).toMatchObject({ status: 'running', currentStep: 'collect' });

        expect((await a.client.steerFlow(flowRunId, 'pause')).status).toBe('paused');
        a.release('collect');
        await new Promise(r => setTimeout(r, 100));
        expect(a.ran).toEqual(['collect']); // paused: the next step did not start on the other side
        expect((await a.client.steerFlow(flowRunId, 'resume')).status).toBe('running');
        await until(() => a.ran.includes('report'));
        expect((await a.client.steerFlow(flowRunId, 'cancel')).status).toBe('cancelled');
    });

    it('follows a flow to its end and shows what it returned', async () => {
        const a = await serve();
        const { flowRunId } = await a.client.startFlow('close-month', { month: '2026-10' });
        await until(() => a.ran.includes('collect')); a.release('collect');
        await until(() => a.ran.includes('report')); a.release('report');
        let state: FlowRunState = await a.client.flowRun(flowRunId);
        for (let i = 0; i < 100 && state.status === 'running'; i++) { await new Promise(r => setTimeout(r, 10)); state = await a.client.flowRun(flowRunId); }
        expect(state).toMatchObject({ status: 'done', output: 'closed 2026-10' });
    });

    it('answers with the protocol codes: a run it does not know is 404 TASK_NOT_FOUND (a restarted supervisor reads it as "lost")', async () => {
        const a = await serve();
        await expect(a.client.flowRun('ghost')).rejects.toMatchObject({ status: 404 });
        const missing = await fetch(`${a.url}/v1/agent/flows/nope/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer run' }, body: '{}' });
        expect(missing.status).toBe(404);
        expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('CAPABILITY_NOT_FOUND');
        const ghost = await fetch(`${a.url}/v1/agent/flow-runs/ghost`, { headers: { Authorization: 'Bearer run' } });
        expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe('TASK_NOT_FOUND');
    });
});
