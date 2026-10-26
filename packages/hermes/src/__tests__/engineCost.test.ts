import { Hermes, InProcessConnector, engineRunCost, type Principal } from '../index';
import { fleetFor } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };

describe('engineRunCost', () => {
    it('reads the last run cost from the engine observability', () => {
        expect(engineRunCost({ observability: { getRunCost: () => 0.0123 } })).toBe(0.0123);
    });

    it('is undefined when there is no observability, or nothing was priced', () => {
        expect(engineRunCost({})).toBeUndefined();
        expect(engineRunCost({ observability: { getRunCost: () => 0 } })).toBeUndefined();
        expect(engineRunCost({ observability: { getRunCost: () => NaN } })).toBeUndefined();
    });

    it('feeds the daily budget when an in-process handler reports it', async () => {
        const engine = { observability: { getRunCost: () => 0.6 } };
        const connector = new InProcessConnector({
            name: 'w',
            capabilities: { work: { handler: async (_i, _s, run) => { run?.reportCost(engineRunCost(engine) ?? 0); return 'ok'; } } },
        });
        const hermes = new Hermes({
            fleet: fleetFor([{ id: 'w', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' }, limits: { budgetUsdPerDay: 1 } }]),
            inProcess: { w: connector },
        });
        await hermes.start();
        try {
            await hermes.run(ops, { agentId: 'w', capability: 'work' });
            await hermes.run(ops, { agentId: 'w', capability: 'work' });
            await expect(hermes.run(ops, { agentId: 'w', capability: 'work' })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
        } finally { await hermes.stop(); }
    });
});
