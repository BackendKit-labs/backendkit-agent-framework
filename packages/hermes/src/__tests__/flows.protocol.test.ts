import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentServer } from '@backendkit-labs/agent-protocol';
import { Hermes, serveFlows, type InProcessFlow, type Principal } from '../index';
import { fleetFor, freePort, until } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };

/** The agent side: a service that hosts flows over agent-protocol, with its own keys. */
async function startFlowAgent(port?: number) {
    const ran: string[] = [];
    const waiting = new Map<string, () => void>();
    const gate = (name: string) => new Promise<void>(resolve => { waiting.set(name, resolve); });
    const flows: Record<string, InProcessFlow> = {
        'close-month': {
            description: 'collects and reports', steps: ['collect', 'report'],
            run: async (input, ctl) => {
                for (const name of ['collect', 'report']) { await ctl.step(name); ran.push(name); await gate(name); }
                return `closed ${String(input.month)}`;
            },
        },
    };
    const { handler, host } = serveFlows(flows);
    const p = port ?? await freePort();
    const server = new AgentServer({ name: 'books', version: '1.0.0', description: 'books', port: p, apiKey: 'run-key', controlApiKey: 'ctl-key', flowHandler: handler });
    await server.start();
    let stopped = false;
    return {
        port: p, url: `http://127.0.0.1:${p}`, ran,
        release: (name: string) => { waiting.get(name)?.(); waiting.delete(name); },
        stop: async () => { if (!stopped) { stopped = true; await host.close(); await server.stop(); } },
    };
}

let dir: string;
const live: Array<{ stop(): Promise<unknown> }> = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hermes-flows-http-')); });
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); rmSync(dir, { recursive: true, force: true }); });

const env = { RUN: 'run-key', CTL: 'ctl-key' };
const entry = (url: string, withControl = true) => ({
    id: 'books', connector: { kind: 'protocol', url, apiKey: { env: 'RUN' }, ...(withControl ? { controlApiKey: { env: 'CTL' } } : {}), pollIntervalMs: 50 },
    health: { intervalSec: 30 }, access: { roles: ['ops'], approval: 'never' },
});

async function boot(url: string, opts: { withControl?: boolean; storeFile?: string } = {}) {
    const hermes = new Hermes({ fleet: fleetFor([entry(url, opts.withControl ?? true)]), env, ...(opts.storeFile ? { storeFile: opts.storeFile } : {}) });
    live.push(hermes);
    await hermes.start();
    return hermes;
}

describe('Hermes controls the flows of an agent in another process', () => {
    it('lists, starts, watches, pauses, resumes and cancels a flow over agent-protocol', async () => {
        const agent = await startFlowAgent(); live.push(agent);
        const hermes = await boot(agent.url);

        expect((await hermes.flowList(ops, 'books')).flows.map(f => f.name)).toEqual(['close-month']);
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month', input: { month: '2026-09' } });
        await until(() => agent.ran.includes('collect'));
        expect((await hermes.flowStatus(ops, runId)).flow).toMatchObject({ status: 'running', currentStep: 'collect' });

        expect((await hermes.flowPause(ops, runId)).flow.status).toBe('paused');
        agent.release('collect');
        await new Promise(r => setTimeout(r, 120));
        expect(agent.ran).toEqual(['collect']); // paused: the next step did not start on the other side
        expect((await hermes.flowResume(ops, runId)).flow.status).toBe('running');
        await until(() => agent.ran.includes('report'));

        const cancelled = await hermes.cancel(ops, runId);
        expect(cancelled.status).toBe('cancelled');
        expect((await hermes.flowStatus(ops, runId)).flow.status).toBe('cancelled');
    });

    it('follows a flow to its end and keeps the result', async () => {
        const agent = await startFlowAgent(); live.push(agent);
        const hermes = await boot(agent.url);
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month', input: { month: '2026-10' } });
        await until(() => agent.ran.includes('collect')); agent.release('collect');
        await until(() => agent.ran.includes('report')); agent.release('report');
        await until(() => hermes.status(ops, runId).status === 'done', 5000);
        expect(hermes.result(ops, runId).output).toBe('closed 2026-10');
    });

    it('steering needs the agent\'s control key: without it Hermes can start and watch but not pause or cancel', async () => {
        const agent = await startFlowAgent(); live.push(agent);
        const hermes = await boot(agent.url, { withControl: false });
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => agent.ran.includes('collect'));
        expect((await hermes.flowStatus(ops, runId)).flow.status).toBe('running');
        await expect(hermes.flowPause(ops, runId)).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
        expect((await hermes.flowStatus(ops, runId)).flow.status).toBe('running');
    });

    it('after a restart of Hermes the flow run is picked up again where the agent has it', async () => {
        const agent = await startFlowAgent(); live.push(agent);
        const storeFile = join(dir, 'runs.json');
        const first = await boot(agent.url, { storeFile });
        const { runId } = await first.flowRun(ops, { agentId: 'books', flow: 'close-month', input: { month: '2026-11' } });
        await until(() => agent.ran.includes('collect'));
        await first.stop();

        const second = await boot(agent.url, { storeFile });
        expect(second.status(ops, runId).status).toBe('running');
        expect((await second.flowStatus(ops, runId)).flow.currentStep).toBe('collect');
        agent.release('collect'); await until(() => agent.ran.includes('report')); agent.release('report');
        await until(() => second.status(ops, runId).status === 'done', 5000);
        expect(second.result(ops, runId).output).toBe('closed 2026-11');
    });

    it('a flow run the agent no longer knows is lost', async () => {
        const first = await startFlowAgent();
        const storeFile = join(dir, 'runs.json');
        const hermes1 = await boot(first.url, { storeFile });
        const { runId } = await hermes1.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => first.ran.includes('collect'));
        await hermes1.stop();
        await first.stop();

        const second = await startFlowAgent(first.port); live.push(second); // same address, new process: it has never heard of the run
        const hermes2 = await boot(second.url, { storeFile });
        expect(hermes2.status(ops, runId).status).toBe('lost');
    });

    it('an agent that hosts no flows is not offered as one', async () => {
        const port = await freePort();
        const plain = new AgentServer({ name: 'plain', version: '1.0.0', description: 'p', port, apiKey: 'run-key' });
        await plain.start(); live.push({ stop: () => plain.stop() });
        const hermes = await boot(`http://127.0.0.1:${port}`);
        await expect(hermes.flowList(ops, 'books')).rejects.toMatchObject({ code: 'CONTROL_UNSUPPORTED' });
    });
});
