import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext, ToolDefinition } from '@backendkit-labs/agent-core';
import { Hermes, InProcessConnector, createFleetTools, parseFleet, type AuditEvent, type InProcessFlow, type Principal } from '../index';
import { until } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };
const guest: Principal = { id: 'gus', roles: ['guest'] };

/** A flow whose steps each wait for the test to let them finish, so the test decides when the flow can move. */
function makeFlows() {
    const ran: string[] = [];
    const waiting = new Map<string, () => void>();
    const gate = (name: string) => new Promise<void>(resolve => { waiting.set(name, resolve); });
    const release = (name: string) => { waiting.get(name)?.(); waiting.delete(name); };
    const flows: Record<string, InProcessFlow> = {
        'close-month': {
            description: 'collects, reconciles and reports',
            steps: ['collect', 'reconcile', 'report'],
            run: async (input, ctl) => {
                for (const name of ['collect', 'reconcile', 'report']) {
                    await ctl.step(name);
                    ran.push(name);
                    await gate(name);
                }
                return `closed ${String(input.month ?? '?')}`;
            },
        },
        broken: { run: async (_i, ctl) => { await ctl.step('only'); throw new Error('the ledger is locked'); } },
    };
    return { flows, ran, release, waiting };
}

let dir: string;
const live: Array<{ stop(): Promise<unknown> }> = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hermes-flows-')); });
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); rmSync(dir, { recursive: true, force: true }); });

async function boot(opts: { access?: Record<string, unknown>; approver?: () => boolean; files?: boolean; withFlows?: boolean } = {}) {
    const rig = makeFlows();
    const audit: AuditEvent[] = [];
    const books = new InProcessConnector({ name: 'books', capabilities: { noop: { handler: async () => 'ok' } }, ...(opts.withFlows === false ? {} : { flows: rig.flows }) });
    const fleet = parseFleet(JSON.stringify({
        fleet: 'f',
        agents: [{ id: 'books', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never', ...(opts.access ?? {}) } }],
    }));
    const hermes = new Hermes({
        fleet, inProcess: { books }, onAudit: e => audit.push(e),
        ...(opts.approver ? { approver: opts.approver } : {}),
        ...(opts.files ? { storeFile: join(dir, 'runs.json') } : {}),
    });
    live.push(hermes);
    await hermes.start();
    return { hermes, audit, ...rig };
}

const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'resolved'; };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe('flows of another agent', () => {
    it('lists the flows an agent hosts, and refuses an agent that hosts none', async () => {
        const { hermes } = await boot();
        expect((await hermes.flowList(ops, 'books')).flows).toEqual([
            { name: 'close-month', description: 'collects, reconciles and reports', steps: ['collect', 'reconcile', 'report'] },
            { name: 'broken' },
        ]);
        const bare = await boot({ withFlows: false });
        expect(await codeOf(bare.hermes.flowList(ops, 'books'))).toBe('CONTROL_UNSUPPORTED');
    });

    it('starts a flow, shows the step it is on, and follows it to the end', async () => {
        const { hermes, release } = await boot();
        const started = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month', input: { month: '2026-09' } });
        expect(started.status).toBe('running');

        await until(async () => (await hermes.flowStatus(ops, started.runId)).flow.currentStep === 'collect');
        expect((await hermes.flowStatus(ops, started.runId)).flow.steps.map(s => [s.name, s.status])).toEqual([['collect', 'running'], ['reconcile', 'pending'], ['report', 'pending']]);

        release('collect');
        await until(async () => (await hermes.flowStatus(ops, started.runId)).flow.currentStep === 'reconcile');
        release('reconcile');
        await until(async () => (await hermes.flowStatus(ops, started.runId)).flow.currentStep === 'report');
        release('report');
        await until(() => hermes.status(ops, started.runId).status === 'done', 3000);
        expect(hermes.result(ops, started.runId).output).toBe('closed 2026-09');
        const done = await hermes.flowStatus(ops, started.runId);
        expect(done.flow.steps.every(s => s.status === 'done')).toBe(true);
    });

    it('pauses a flow at its next step boundary and resumes it', async () => {
        const { hermes, release, ran, audit } = await boot();
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => ran.includes('collect'));

        const paused = await hermes.flowPause(ops, runId);
        expect(paused.flow.status).toBe('paused');
        release('collect'); // the step in progress finishes...
        await tick(80);
        expect(ran).toEqual(['collect']); // ...but the flow does not start the next one
        expect((await hermes.flowStatus(ops, runId)).flow.status).toBe('paused');
        expect(hermes.status(ops, runId).status).toBe('running'); // a paused flow is still a run in progress

        const resumed = await hermes.flowResume(ops, runId);
        expect(resumed.flow.status).toBe('running');
        await until(() => ran.includes('reconcile'));
        release('reconcile'); await until(() => ran.includes('report')); release('report');
        await until(() => hermes.status(ops, runId).status === 'done', 3000);
        expect(audit.filter(e => e.capability === 'flow_pause' || e.capability === 'flow_resume').map(e => [e.capability, e.outcome, e.principalId])).toEqual([['flow_pause', 'allowed', 'olga'], ['flow_resume', 'allowed', 'olga']]);
    });

    it('cancels a paused flow: it never starts another step and the run ends cancelled', async () => {
        const { hermes, release, ran, audit } = await boot();
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => ran.includes('collect'));
        await hermes.flowPause(ops, runId);
        release('collect');
        await tick(50);

        const cancelled = await hermes.cancel(ops, runId);
        expect(cancelled.status).toBe('cancelled');
        expect((await hermes.flowStatus(ops, runId)).flow).toMatchObject({ status: 'cancelled' });
        await tick(80);
        expect(ran).toEqual(['collect']);
        expect(audit.find(e => e.action === 'cancel')).toMatchObject({ outcome: 'allowed', runId, principalId: 'olga' });
    });

    it('cancels a flow that is mid-step too, once that step ends', async () => {
        const { hermes, release, ran } = await boot();
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => ran.includes('collect'));
        const pending = hermes.cancel(ops, runId); // the step is still waiting: cancel returns after the grace period or when the flow reaches a boundary
        release('collect');
        expect((await pending).status).toBe('cancelled');
        await tick(50);
        expect(ran).toEqual(['collect']);
    });

    it('a flow that fails is a failed run with the reason', async () => {
        const { hermes } = await boot();
        const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'broken' });
        await until(() => hermes.status(ops, runId).status === 'failed', 3000);
        expect(hermes.result(ops, runId).error).toBe('the ledger is locked');
        expect((await hermes.flowStatus(ops, runId)).flow.steps).toEqual([{ name: 'only', status: 'failed' }]);
    });

    describe('under the same rules as any run', () => {
        it('a principal without the role is FORBIDDEN, an unknown flow is not found, and nothing starts', async () => {
            const { hermes, ran } = await boot();
            expect(await codeOf(hermes.flowRun(guest, { agentId: 'books', flow: 'close-month' }))).toBe('FORBIDDEN');
            expect(await codeOf(hermes.flowRun(ops, { agentId: 'books', flow: 'nope' }))).toBe('CAPABILITY_NOT_FOUND');
            expect(ran).toEqual([]);
            expect(hermes.store.list()).toEqual([]);
        });

        it('needs approval when the flow does, and without an approver it never starts', async () => {
            const access = { capabilities: { 'flow:close-month': { approval: 'always' } } };
            const closed = await boot({ access });
            expect(await codeOf(closed.hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' }))).toBe('APPROVAL_REQUIRED');
            expect(closed.ran).toEqual([]);

            const asked: unknown[] = [];
            const open = await boot({ access, approver: () => { asked.push(1); return true; } });
            await open.hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
            expect(asked).toHaveLength(1);
            await open.hermes.flowRun(ops, { agentId: 'books', flow: 'broken' }); // another flow of the same agent is not affected
            expect(asked).toHaveLength(1);
        });

        it('a flow run of an agent the principal may not use is not visible to them', async () => {
            const { hermes } = await boot();
            const { runId } = await hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
            expect(await codeOf(hermes.flowStatus(guest, runId))).toBe('RUN_NOT_FOUND');
            expect(await codeOf(hermes.flowPause(guest, runId))).toBe('RUN_NOT_FOUND');
        });

        it('a plain run is not a flow run', async () => {
            const { hermes } = await boot();
            const run = await hermes.run(ops, { agentId: 'books', capability: 'noop' });
            expect(await codeOf(hermes.flowStatus(ops, run.runId))).toBe('RUN_NOT_FOUND');
        });
    });

    it('a flow does not outlive Hermes: after a restart its run is lost', async () => {
        const first = await boot({ files: true });
        const { runId } = await first.hermes.flowRun(ops, { agentId: 'books', flow: 'close-month' });
        await until(() => first.ran.includes('collect'));
        await first.hermes.stop();

        const second = await boot({ files: true });
        expect(second.hermes.status(ops, runId).status).toBe('lost');
    });

    it('is available to the model as flow_* tools', async () => {
        const { hermes, release, ran } = await boot();
        const list = createFleetTools(hermes, { principal: () => ops });
        const call = (name: string, args: Record<string, unknown>) => (list.find(t => t.name === name) as ToolDefinition).execute(args, {} as ExecutionContext);

        expect(JSON.parse(await call('flow_list', { agent: 'books' })).flows).toHaveLength(2);
        const { runId } = JSON.parse(await call('flow_run', { agent: 'books', flow: 'close-month', input: { month: '2026-10' } }));
        await until(() => ran.includes('collect'));
        expect(JSON.parse(await call('flow_pause', { run_id: runId })).flow.status).toBe('paused');
        expect(JSON.parse(await call('flow_status', { run_id: runId })).flow.currentStep).toBe('collect');
        expect(JSON.parse(await call('flow_resume', { run_id: runId })).flow.status).toBe('running');
        release('collect');
        const cancelled = JSON.parse(await call('flow_cancel', { run_id: runId }));
        expect(cancelled.status).toBe('cancelled');
        expect(await call('flow_status', { run_id: 'nope' })).toMatch(/^Error: RUN_NOT_FOUND/);
    });
});
