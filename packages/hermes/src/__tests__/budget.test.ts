import { Hermes, HermesError, InProcessConnector, type AuditEvent, type Principal } from '../index';
import { AgentServer, type CapabilityDefinition } from '@backendkit-labs/agent-protocol';
import { fleetFor, freePort } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };

const live: Array<{ stop(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); });

const agent = (id: string, extra: Record<string, unknown> = {}) => ({
    id, connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' }, ...extra,
});

/** `spend` costs what the test says; `free` reports nothing, like an agent that does not measure itself. */
function metered(cost: { usd: number }) {
    return new InProcessConnector({
        name: 'worker',
        capabilities: {
            spend: { handler: async (_input, _signal, run) => { run?.reportCost(cost.usd); return 'ok'; } },
            free: { handler: async () => 'ok' },
            broke: { handler: async (_input, _signal, run) => { run?.reportCost(cost.usd); throw new Error('kaput'); } },
        },
    });
}

async function boot(agents: Array<Record<string, unknown>>, inProcess: Record<string, InProcessConnector>, extra: Record<string, unknown> = {}) {
    const audit: AuditEvent[] = [];
    const hermes = new Hermes({ fleet: fleetFor(agents, extra), inProcess, onAudit: e => audit.push(e) });
    live.push(hermes);
    await hermes.start();
    return { hermes, audit };
}

const run = (hermes: Hermes, agentId: string, capability: string) => hermes.run(ops, { agentId, capability });

describe('budget enforced from the cost agents report (C3b)', () => {
    it('stores the cost a run reports and shows it in the run', async () => {
        const { hermes } = await boot([agent('worker')], { worker: metered({ usd: 0.25 }) });
        const done = await run(hermes, 'worker', 'spend');
        expect(done.status).toBe('done');
        expect(done.costUsd).toBe(0.25);
        expect(hermes.store.get(done.runId)?.costUsd).toBe(0.25);
    });

    it('refuses new runs with BUDGET_EXCEEDED once the agent spent its budgetUsdPerDay', async () => {
        const { hermes, audit } = await boot([agent('worker', { limits: { budgetUsdPerDay: 0.5 } })], { worker: metered({ usd: 0.3 }) });
        await run(hermes, 'worker', 'spend'); // 0.3 < 0.5: admitted
        await run(hermes, 'worker', 'spend'); // 0.3 < 0.5 at admission: admitted, now 0.6 (soft cap at the edge)
        const refused = await run(hermes, 'worker', 'spend').catch(e => e);
        expect(refused).toBeInstanceOf(HermesError);
        expect((refused as HermesError).code).toBe('BUDGET_EXCEEDED');
        expect(audit.some(e => e.outcome === 'denied' && String(e.reason).includes('0.6000 of its 0.5 USD/day'))).toBe(true);
    });

    it('counts the cost of a run that failed after spending', async () => {
        const { hermes } = await boot([agent('worker', { limits: { budgetUsdPerDay: 0.5 } })], { worker: metered({ usd: 0.6 }) });
        const failed = await run(hermes, 'worker', 'broke');
        expect(failed.status).toBe('failed');
        expect(failed.costUsd).toBe(0.6);
        await expect(run(hermes, 'worker', 'free')).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    });

    it('does not limit an agent that reports no cost, however much it runs', async () => {
        const { hermes } = await boot([agent('worker', { limits: { budgetUsdPerDay: 0.01 } })], { worker: metered({ usd: 1 }) });
        for (let i = 0; i < 3; i++) expect((await run(hermes, 'worker', 'free')).status).toBe('done');
    });

    it('applies policies.budget.perDayUsd to the whole fleet, and spares nobody', async () => {
        const { hermes } = await boot([agent('a'), agent('b')], { a: metered({ usd: 0.6 }), b: metered({ usd: 0.6 }) }, { policies: { budget: { perDayUsd: 1 } } });
        await run(hermes, 'a', 'spend');
        await run(hermes, 'b', 'spend'); // 0.6 < 1 at admission; the fleet is now at 1.2
        await expect(run(hermes, 'a', 'free')).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
        await expect(run(hermes, 'b', 'free')).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    });

    it('one agent over its budget does not stop another', async () => {
        const { hermes } = await boot([agent('a', { limits: { budgetUsdPerDay: 0.1 } }), agent('b')], { a: metered({ usd: 0.2 }), b: metered({ usd: 0.2 }) });
        await run(hermes, 'a', 'spend');
        await expect(run(hermes, 'a', 'free')).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
        expect((await run(hermes, 'b', 'spend')).status).toBe('done');
    });

    it('spend from a previous UTC day does not count', async () => {
        const { hermes } = await boot([agent('worker', { limits: { budgetUsdPerDay: 0.5 } })], { worker: metered({ usd: 0.1 }) });
        await hermes.store.put({
            runId: 'old', agentId: 'worker', capability: 'spend', inputPreview: '{}', status: 'done', principalId: 'olga',
            startedAt: new Date(Date.now() - 36 * 3600_000).toISOString(), costUsd: 99,
        });
        expect((await run(hermes, 'worker', 'spend')).status).toBe('done');
    });

    it('ignores negative and non-finite amounts a handler reports', async () => {
        const c = new InProcessConnector({ name: 'w', capabilities: { odd: { handler: async (_i, _s, r) => { r?.reportCost(-5); r?.reportCost(NaN); return 'ok'; } } } });
        const { hermes } = await boot([agent('w')], { w: c });
        expect((await run(hermes, 'w', 'odd')).costUsd).toBeUndefined();
    });
});

describe('cost over agent-protocol', () => {
    const def = (name: string, async: boolean): CapabilityDefinition => ({ name, description: name, async, input: {}, output: {} });

    it('carries costUsd from the remote handler to the run and enforces the budget on it (sync and async)', async () => {
        const port = await freePort();
        const server = new AgentServer({ name: 'remote', version: '1.0.0', description: 'd', port });
        server.register({ definition: def('quick', false), execute: async (_i, ctx) => { ctx.reportCost?.(0.4); return 'ok'; } });
        server.register({ definition: def('later', true), execute: async (_i, ctx) => { ctx.reportCost?.(0.4); return 'ok'; } });
        await server.start();
        try {
            const hermes = new Hermes({
                fleet: fleetFor([{ id: 'remote', connector: { kind: 'protocol', url: `http://127.0.0.1:${port}`, pollIntervalMs: 20 }, access: { roles: ['ops'], approval: 'never' }, limits: { budgetUsdPerDay: 0.7 } }]),
            });
            live.push(hermes);
            await hermes.start();
            expect((await hermes.run(ops, { agentId: 'remote', capability: 'quick' })).costUsd).toBe(0.4);
            const later = await hermes.run(ops, { agentId: 'remote', capability: 'later', wait: true, waitMs: 3000 });
            expect(later.status).toBe('done');
            expect(later.costUsd).toBe(0.4);
            await expect(hermes.run(ops, { agentId: 'remote', capability: 'quick' })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
        } finally { await server.stop(); }
    });
});
