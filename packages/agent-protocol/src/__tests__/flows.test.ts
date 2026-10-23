import * as net from 'node:net';
import { AgentServer, AgentClient, ControlError } from '../index';
import type { FlowHandler, FlowRunState } from '../index';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as net.AddressInfo;
            s.close(() => resolve(port));
        });
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();
const auth = (key?: string): Record<string, string> => ({ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

/** A flow host that keeps its runs in memory: just enough to see the surface work. */
function memoryFlows(): FlowHandler & { runs: Map<string, FlowRunState> } {
    const runs = new Map<string, FlowRunState>();
    const get = (id: string): FlowRunState => {
        const r = runs.get(id);
        if (!r) throw new ControlError('TASK_NOT_FOUND', `flow run ${id} not found`);
        return r;
    };
    return {
        runs,
        flows: () => [{ name: 'close-month', description: 'month end', steps: ['collect', 'report'] }],
        start: async (flow, input) => {
            if (flow !== 'close-month') throw new ControlError('CAPABILITY_NOT_FOUND', `flow ${flow} not found`);
            const flowRunId = `fr-${runs.size + 1}`;
            runs.set(flowRunId, { flowRunId, flow, status: 'running', currentStep: 'collect', steps: [{ name: 'collect', status: 'running' }, { name: 'report', status: 'pending' }], startedAt: new Date().toISOString(), output: JSON.stringify(input) });
            return { flowRunId };
        },
        status: async id => ({ ...get(id) }),
        pause: async id => { const r = get(id); r.status = 'paused'; return { ...r }; },
        resume: async id => { const r = get(id); r.status = 'running'; return { ...r }; },
        cancel: async id => { const r = get(id); r.status = 'cancelled'; return { ...r }; },
    };
}

const running: AgentServer[] = [];
async function start(opts: Partial<ConstructorParameters<typeof AgentServer>[0]> = {}) {
    const port = await freePort();
    const handler = memoryFlows();
    const server = new AgentServer({ name: 'flows', version: '1.0.0', description: 'd', port, flowHandler: handler, ...opts });
    await server.start();
    running.push(server);
    return { server, url: `http://127.0.0.1:${port}`, handler };
}
afterAll(async () => { await Promise.all(running.map(s => s.stop())); });

describe('flows over agent-protocol', () => {
    it('publishes its flows in info and lists them', async () => {
        const { url } = await start({ apiKey: 'run' });
        const info = (await json(await fetch(`${url}/v1/agent/info`, { headers: auth('run') }))).data;
        expect(info).toMatchObject({ flowControl: true, flows: [{ name: 'close-month' }] });
        const list = await json(await fetch(`${url}/v1/agent/flows`, { headers: auth('run') }));
        expect(list.data.flows[0].steps).toEqual(['collect', 'report']);
    });

    it('starts and watches a flow with the run key; pausing, resuming and cancelling need the control key', async () => {
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        const started = await json(await fetch(`${url}/v1/agent/flows/close-month/runs`, { method: 'POST', headers: auth('run'), body: '{"input":{"month":"2026-09"}}' }));
        const id = started.data.flowRunId;
        const status = await json(await fetch(`${url}/v1/agent/flow-runs/${id}`, { headers: auth('run') }));
        expect(status.data).toMatchObject({ status: 'running', currentStep: 'collect' });

        const withRunKey = await fetch(`${url}/v1/agent/flow-runs/${id}/pause`, { method: 'POST', headers: auth('run'), body: '{}' });
        expect(withRunKey.status).toBe(401);
        const paused = await json(await fetch(`${url}/v1/agent/flow-runs/${id}/pause`, { method: 'POST', headers: auth('ctl'), body: '{}' }));
        expect(paused.data.status).toBe('paused');
        expect((await json(await fetch(`${url}/v1/agent/flow-runs/${id}/resume`, { method: 'POST', headers: auth('ctl'), body: '{}' }))).data.status).toBe('running');
        expect((await json(await fetch(`${url}/v1/agent/flow-runs/${id}/cancel`, { method: 'POST', headers: auth('ctl'), body: '{}' }))).data.status).toBe('cancelled');
        expect((await fetch(`${url}/v1/agent/flow-runs/${id}`, { headers: auth('ctl') })).status).toBe(401); // the control key does not open the run surface
    });

    it('without a controlApiKey the steering endpoints stay closed, whatever else is configured', async () => {
        const { url, handler } = await start({ apiKey: 'run' });
        const started = await json(await fetch(`${url}/v1/agent/flows/close-month/runs`, { method: 'POST', headers: auth('run'), body: '{}' }));
        const res = await fetch(`${url}/v1/agent/flow-runs/${started.data.flowRunId}/cancel`, { method: 'POST', headers: auth('run'), body: '{}' });
        expect(res.status).toBe(403);
        expect((await json(res)).error.code).toBe('FORBIDDEN');
        expect(handler.runs.get(started.data.flowRunId)!.status).toBe('running');
    });

    it('answers with the codes the host raises, and refuses a flow it does not have', async () => {
        const { url } = await start({ controlApiKey: 'ctl' });
        const missing = await fetch(`${url}/v1/agent/flows/nope/runs`, { method: 'POST', headers: auth(), body: '{}' });
        expect(missing.status).toBe(404);
        expect((await json(missing)).error.code).toBe('CAPABILITY_NOT_FOUND');
        const unknownRun = await fetch(`${url}/v1/agent/flow-runs/ghost`, { headers: auth() });
        expect(unknownRun.status).toBe(404);
        expect((await json(unknownRun)).error.code).toBe('TASK_NOT_FOUND');
        expect((await fetch(`${url}/v1/agent/flows/close-month/runs`, { method: 'POST', headers: auth(), body: '{"input":[1]}' })).status).toBe(400);
    });

    it('a draining agent starts no new flow, and an agent with no flow handler says so', async () => {
        const { url } = await start({ controlApiKey: 'ctl' });
        await fetch(`${url}/v1/agent/control`, { method: 'POST', headers: auth('ctl'), body: '{"action":"drain"}' });
        expect((await fetch(`${url}/v1/agent/flows/close-month/runs`, { method: 'POST', headers: auth(), body: '{}' })).status).toBe(503);

        const bare = await start({ flowHandler: undefined });
        expect((await fetch(`${bare.url}/v1/agent/flows`, { headers: auth() })).status).toBe(501);
        expect((await json(await fetch(`${bare.url}/v1/agent/info`, { headers: auth() }))).data.flowControl).toBeUndefined();
    });

    it('AgentClient lists, starts, watches and steers; steering never rides on the run key', async () => {
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        const client = new AgentClient({ url, apiKey: 'run', controlApiKey: 'ctl', maxRetries: 0 });
        expect((await client.listFlows())[0].name).toBe('close-month');
        const { flowRunId } = await client.startFlow('close-month', { month: '2026-10' });
        expect(await client.flowRun(flowRunId)).toMatchObject({ status: 'running' });
        expect((await client.steerFlow(flowRunId, 'pause')).status).toBe('paused');
        expect((await client.steerFlow(flowRunId, 'cancel')).status).toBe('cancelled');
        await expect(client.flowRun('ghost')).rejects.toMatchObject({ status: 404 });

        const noControl = new AgentClient({ url, apiKey: 'run', maxRetries: 0 });
        await expect(noControl.steerFlow(flowRunId, 'pause')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('starting a flow is sent once even when the client is set to retry: a retry could start a second run', async () => {
        let starts = 0;
        const handler = memoryFlows();
        const flaky: FlowHandler = { ...handler, start: async () => { starts++; throw new ControlError('AGENT_UNAVAILABLE', 'busy'); } };
        const { url } = await start({ apiKey: 'run', flowHandler: flaky });
        const client = new AgentClient({ url, apiKey: 'run', maxRetries: 3 });
        await expect(client.startFlow('close-month')).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE', status: 503 });
        expect(starts).toBe(1);
    });
});
