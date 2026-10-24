import { Hermes, HermesError, InProcessConnector, fleetWarnings, parseFleet, type AuditEvent, type Principal } from '../index';
import { fleetFor, until } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };

const live: Array<{ stop(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); });

const agent = (id: string, extra: Record<string, unknown> = {}) => ({
    id, connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' }, ...extra,
});

/** An agent whose `hold` runs go on until the test lets them end, so a test controls how many are going. */
function holder() {
    const release: Array<() => void> = [];
    const connector = new InProcessConnector({
        name: 'worker',
        capabilities: {
            hold: {
                async: true,
                handler: (_input, signal) => new Promise<string>((resolve, reject) => {
                    release.push(() => resolve('done'));
                    signal.addEventListener('abort', () => reject(new Error('aborted'))); // a real handler honours cancel
                }),
            },
            quick: { handler: async () => 'ok' },
            boom: { handler: async () => { throw new Error('kaput'); } },
        },
    });
    return { connector, release };
}

async function boot(agents: Array<Record<string, unknown>>, inProcess: Record<string, InProcessConnector>, extra: { approver?: (r: unknown) => boolean | Promise<boolean> } = {}) {
    const audit: AuditEvent[] = [];
    const hermes = new Hermes({ fleet: fleetFor(agents), inProcess, onAudit: e => audit.push(e), ...(extra.approver ? { approver: extra.approver as never } : {}) });
    live.push(hermes);
    await hermes.start();
    return { hermes, audit };
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try { await p; } catch (e) { return (e as HermesError).code ?? (e as Error).message; }
    return 'resolved';
};
const hold = (hermes: Hermes, agentId = 'worker') => hermes.run(ops, { agentId, capability: 'hold' });

describe('limits.maxConcurrent is enforced', () => {
    it('refuses a run past the limit with AGENT_BUSY and accepts one again when a run ends', async () => {
        const w = holder();
        const { hermes, audit } = await boot([agent('worker', { limits: { maxConcurrent: 2 } })], { worker: w.connector });

        const first = await hold(hermes);
        await hold(hermes);
        expect(await codeOf(hold(hermes))).toBe('AGENT_BUSY');
        expect(audit.find(e => e.outcome === 'denied' && e.reason?.includes('maxConcurrent'))).toMatchObject({ agentId: 'worker', principalId: 'olga' });

        w.release[0]();
        await until(() => hermes.status(ops, first.runId).status === 'done');
        expect((await hold(hermes)).status).toBe('running');
        expect(await codeOf(hold(hermes))).toBe('AGENT_BUSY'); // back at two
    });

    it('the message says how many are going and what the limit is', async () => {
        const w = holder();
        const { hermes } = await boot([agent('worker', { limits: { maxConcurrent: 1 } })], { worker: w.connector });
        await hold(hermes);
        await expect(hold(hermes)).rejects.toThrow(/1 run\(s\) already going, limits\.maxConcurrent is 1/);
    });

    it('lets exactly maxConcurrent start when many calls arrive together', async () => {
        const w = holder();
        const { hermes } = await boot([agent('worker', { limits: { maxConcurrent: 2 } })], { worker: w.connector });
        const settled = await Promise.allSettled(Array.from({ length: 8 }, () => hold(hermes)));
        expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(2);
        const refused = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
        expect(refused).toHaveLength(6);
        expect(refused.every(r => (r.reason as HermesError).code === 'AGENT_BUSY')).toBe(true);
        expect(w.release).toHaveLength(2); // the agent really started two, not more
    });

    it('does not ask anybody to approve a run that cannot start', async () => {
        const w = holder();
        const asked: unknown[] = [];
        const { hermes } = await boot(
            [agent('worker', { limits: { maxConcurrent: 1 }, access: { roles: ['ops'], approval: 'ask' } })],
            { worker: w.connector },
            { approver: r => { asked.push(r); return true; } },
        );
        await hold(hermes);
        expect(asked).toHaveLength(1);
        expect(await codeOf(hold(hermes))).toBe('AGENT_BUSY');
        expect(asked).toHaveLength(1);
    });

    it('does not hold the slot while a human is deciding, and checks again once they have', async () => {
        const w = holder();
        let open!: () => void;
        const gate = new Promise<void>(r => { open = r; });
        let calls = 0;
        const { hermes } = await boot(
            [agent('worker', { limits: { maxConcurrent: 1 }, access: { roles: ['ops'], approval: 'ask' } })],
            { worker: w.connector },
            { approver: async () => { calls++; if (calls === 1) await gate; return true; } },
        );
        const slowToApprove = hold(hermes);                         // waits for a human
        await until(() => calls === 1);
        const meanwhile = await hold(hermes);                       // another call is approved at once and takes the slot
        expect(meanwhile.status).toBe('running');
        open();                                                     // the human finally says yes
        expect(await codeOf(slowToApprove)).toBe('AGENT_BUSY');     // the room is gone: it is refused, not started over the limit
        expect(w.release).toHaveLength(1);
    });

    it('a run that fails frees its slot', async () => {
        const w = holder();
        const { hermes } = await boot([agent('worker', { limits: { maxConcurrent: 1 } })], { worker: w.connector });
        expect((await hermes.run(ops, { agentId: 'worker', capability: 'boom' })).status).toBe('failed');
        expect((await hermes.run(ops, { agentId: 'worker', capability: 'quick' })).status).toBe('done');
        expect((await hermes.run(ops, { agentId: 'worker', capability: 'boom' })).status).toBe('failed');
        expect((await hold(hermes)).status).toBe('running');
    });

    it('a cancelled run frees its slot', async () => {
        const w = holder();
        const { hermes } = await boot([agent('worker', { limits: { maxConcurrent: 1 } })], { worker: w.connector });
        const first = await hold(hermes);
        expect(await codeOf(hold(hermes))).toBe('AGENT_BUSY');
        await hermes.cancel(ops, first.runId);
        await until(() => hermes.status(ops, first.runId).status === 'cancelled');
        expect((await hold(hermes)).status).toBe('running');
    });

    it('is per agent: one agent at its limit does not affect another', async () => {
        const a = holder();
        const b = holder();
        const { hermes } = await boot(
            [agent('one', { limits: { maxConcurrent: 1 } }), agent('two', { limits: { maxConcurrent: 1 } }), agent('free')],
            { one: a.connector, two: b.connector, free: holder().connector },
        );
        await hold(hermes, 'one');
        expect(await codeOf(hold(hermes, 'one'))).toBe('AGENT_BUSY');
        expect((await hold(hermes, 'two')).status).toBe('running');
    });

    it('without a limit nothing is refused', async () => {
        const w = holder();
        const { hermes } = await boot([agent('worker')], { worker: w.connector });
        const runs = await Promise.all(Array.from({ length: 12 }, () => hold(hermes)));
        expect(runs.every(r => r.status === 'running')).toBe(true);
    });
});

describe('fleetWarnings: what the file declares that nothing enforces (ADR-0007)', () => {
    const parse = (extra: Record<string, unknown>, agents: Array<Record<string, unknown>> = [agent('worker')]) =>
        parseFleet(JSON.stringify({ fleet: 'f', agents, ...extra }));

    it('is empty for a file that declares no budget, and does not list maxConcurrent, which is enforced', () => {
        expect(fleetWarnings(parse({}))).toEqual([]);
        expect(fleetWarnings(parse({}, [agent('worker', { limits: { maxConcurrent: 3, deadlineMs: 5000 } })]))).toEqual([]);
    });

    it('names the path of an agent budget and says it is not enforced', () => {
        const [w, ...rest] = fleetWarnings(parse({}, [agent('worker', { limits: { budgetUsdPerDay: 5 } })]));
        expect(rest).toEqual([]);
        expect(w.path).toBe('agents.worker.limits.budgetUsdPerDay');
        expect(w.message).toContain('5 USD/day');
        expect(w.message).toContain('not enforced');
    });

    it('lists the fleet-wide budgets that nothing applies', () => {
        const found = fleetWarnings(parse({ policies: { budget: { perRunUsd: 1, perDayUsd: 20 } } }));
        expect(found.map(f => f.path)).toEqual(['policies.budget.perRunUsd', 'policies.budget.perDayUsd']);
    });

    it('the file still loads: a warning is not an error', () => {
        expect(() => parse({ policies: { budget: { perDayUsd: 20 } } }, [agent('worker', { limits: { budgetUsdPerDay: 5 } })])).not.toThrow();
    });
});
