import { PlanExecutor, ruleToGateCriteria } from '../executor.js';
import type { ExecutionResult, GateHit, PlanExecution, ReflectionAdapter, ActiveRule } from '../executor.js';
import type { OrchestratorConfig } from '../config.js';
import type { SubTask, TaskPlan } from '../planner.js';

const config = (agents: Array<Record<string, unknown>> = []): OrchestratorConfig => ({
    version: 1,
    orchestrator: { name: 'T', provider: 'default' },
    providers: {},
    agents: [
        { id: 'a', name: 'A', description: '', capabilities: [], provider: 'default' },
        { id: 'b', name: 'B', description: '', capabilities: [], provider: 'default' },
        ...agents,
    ] as OrchestratorConfig['agents'],
});

const st = (id: string, over: Partial<SubTask> = {}): SubTask =>
    ({ id, agent_id: 'a', task: `task ${id}`, depends_on: [], ...over });

const plan = (...subtasks: SubTask[]): TaskPlan => ({ summary: 'plan', subtasks });

/** dispatchFn that records order and concurrency. */
function tracker(opts: { failIds?: string[]; delayMs?: number } = {}) {
    const order: string[] = [];
    let active = 0, maxActive = 0;
    const dispatchFn = async (s: SubTask, prior: ExecutionResult[]): Promise<ExecutionResult> => {
        active++; maxActive = Math.max(maxActive, active);
        order.push(`${s.id}:prior=${prior.length}`);
        await new Promise(r => setTimeout(r, opts.delayMs ?? 5));
        active--;
        const ok = !opts.failIds?.includes(s.id);
        return { subtask_id: s.id, agent_id: s.agent_id, task: s.task, result: ok ? `out-${s.id}` : 'Error: boom', success: ok, duration_ms: 1 };
    };
    return { dispatchFn, order, maxActive: () => maxActive };
}

const isGate = (r: PlanExecution | GateHit): r is GateHit => 'gateRequired' in r;

describe('PlanExecutor.execute', () => {
    it('runs a linear chain in dependency order, feeding prior results forward', async () => {
        const t = tracker();
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const res = await ex.execute(plan(st('t1'), st('t2', { depends_on: ['t1'] }), st('t3', { depends_on: ['t2'] }))) as PlanExecution;
        expect(res.complete).toBe(true);
        expect(t.order).toEqual(['t1:prior=0', 't2:prior=1', 't3:prior=2']);
        expect(res.results.map(r => r.subtask_id)).toEqual(['t1', 't2', 't3']);
    });

    it('runs independent steps in parallel', async () => {
        const t = tracker({ delayMs: 20 });
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        await ex.execute(plan(st('t1'), st('t2'), st('t3', { depends_on: ['t1', 't2'] })));
        expect(t.maxActive()).toBe(2);
    });

    it('detects a circular dependency instead of hanging', async () => {
        const ex = new PlanExecutor({ config: config(), dispatchFn: tracker().dispatchFn });
        await expect(ex.execute(plan(st('x', { depends_on: ['y'] }), st('y', { depends_on: ['x'] }))))
            .rejects.toThrow(/Circular dependency/);
    });

    it('a failed step does not stop the plan; summary counts successes', async () => {
        const t = tracker({ failIds: ['t1'] });
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const res = await ex.execute(plan(st('t1'), st('t2'))) as PlanExecution;
        expect(res.complete).toBe(true);
        expect(res.summary).toContain('Completed 1/2 sub-tasks.');
        expect(res.summary).toContain('✗');
    });

    it('turns a throwing runSubTask into a failed result when running inline (agent missing)', async () => {
        const ex = new PlanExecutor({ config: config() });
        const res = await ex.execute(plan(st('t1', { agent_id: 'ghost' }))) as PlanExecution;
        expect(res.results[0].result).toBe('No agent configured for id: ghost');
        expect(res.results[0].success).toBe(false);
    });

    it('turns a missing provider into success=false with the error text (inline)', async () => {
        const ex = new PlanExecutor({ config: config() });
        const res = await ex.execute(plan(st('t1'))) as PlanExecution;
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].result).toMatch(/Provider "default" not configured/);
    });
});

describe('gates', () => {
    it('explicit gate on the subtask stops after that step with its output and criteria', async () => {
        const t = tracker();
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const res = await ex.execute(plan(
            st('t1', { gate: true, gate_criteria: ['check X'] }),
            st('t2', { depends_on: ['t1'] }),
        ));
        expect(isGate(res)).toBe(true);
        const g = res as GateHit;
        expect(g).toMatchObject({ stepId: 't1', agentId: 'a', output: 'out-t1', criteria: ['check X'], appliedRuleIds: [] });
        expect(t.order).toEqual(['t1:prior=0']);
    });

    it('agent-level gate config applies when the subtask does not set one', async () => {
        const cfg = config([{ id: 'g', name: 'G', description: '', capabilities: [], provider: 'default', gate: true, gate_criteria: ['agent crit'] }]);
        const ex = new PlanExecutor({ config: cfg, dispatchFn: tracker().dispatchFn });
        const res = await ex.execute(plan(st('t1', { agent_id: 'g' })));
        expect(isGate(res) && res.criteria).toEqual(['agent crit']);
    });

    it('subtask gate=false overrides agent-level gate=true', async () => {
        const cfg = config([{ id: 'g', name: 'G', description: '', capabilities: [], provider: 'default', gate: true }]);
        const ex = new PlanExecutor({ config: cfg, dispatchFn: tracker().dispatchFn });
        const res = await ex.execute(plan(st('t1', { agent_id: 'g', gate: false })));
        expect(isGate(res)).toBe(false);
    });

    it('a failed gated step does not raise a gate', async () => {
        const ex = new PlanExecutor({ config: config(), dispatchFn: tracker({ failIds: ['t1'] }).dispatchFn });
        const res = await ex.execute(plan(st('t1', { gate: true })));
        expect(isGate(res)).toBe(false);
    });

    it('resuming with priorResults skips completed steps and passes them as context', async () => {
        const t = tracker();
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const p = plan(st('t1', { gate: true }), st('t2', { depends_on: ['t1'] }));
        const first = await ex.execute(p) as GateHit;
        const second = await ex.execute(p, first.completedSoFar) as PlanExecution;
        expect(second.complete).toBe(true);
        expect(t.order).toEqual(['t1:prior=0', 't2:prior=1']);
    });

    it('two gated parallel steps each get their own gate; none runs twice', async () => {
        const t = tracker();
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const p = plan(st('t1', { gate: true }), st('t2', { gate: true }));

        const first = await ex.execute(p) as GateHit;
        expect(first.stepId).toBe('t1');
        // t2 is deferred, not silently completed: its output must not be released ungated
        expect(first.completedSoFar.map(r => r.subtask_id)).toEqual(['t1']);
        expect(t.order.filter(o => o.startsWith('t2:'))).toHaveLength(0);

        const second = await ex.execute(p, first.completedSoFar) as GateHit;
        expect(isGate(second)).toBe(true);
        expect(second.stepId).toBe('t2');

        const third = await ex.execute(p, second.completedSoFar) as PlanExecution;
        expect(third.complete).toBe(true);
        expect(t.order.filter(o => o.startsWith('t1:'))).toHaveLength(1);
        expect(t.order.filter(o => o.startsWith('t2:'))).toHaveLength(1);
    });

    it('ungated parallel steps still run alongside the first gated one', async () => {
        const t = tracker();
        const ex = new PlanExecutor({ config: config(), dispatchFn: t.dispatchFn });
        const first = await ex.execute(plan(st('t1', { gate: true }), st('t2'), st('t3', { gate: true }))) as GateHit;
        expect(first.stepId).toBe('t1');
        expect(first.completedSoFar.map(r => r.subtask_id).sort()).toEqual(['t1', 't2']);
    });
});

describe('policy rules (reflection adapter)', () => {
    const rule = (over: Partial<ActiveRule> = {}): ActiveRule => ({
        id: 'r1', name: 'Rule 1',
        trigger: { domain: 'legal', pattern: 'p', minOccurrences: 1 },
        if: { domain: 'legal' },
        then: { requireSecurityReview: true },
        ...over,
    });
    const adapter = (rules: ActiveRule[] | Error): ReflectionAdapter => ({
        activeRules: async () => { if (rules instanceof Error) throw rules; return rules; },
        recordRuleOutcome: async () => {},
    });
    const withDomain = (domain?: string) => config([{ id: 'd', name: 'D', description: '', capabilities: [], provider: 'default', ...(domain ? { domain } : {}) }]);

    it('a domain rule forces a gate with generated criteria and the rule id', async () => {
        const ex = new PlanExecutor({ config: withDomain('legal'), dispatchFn: tracker().dispatchFn, reflection: adapter([rule()]) });
        const res = await ex.execute(plan(st('t1', { agent_id: 'd' }))) as GateHit;
        expect(res.appliedRuleIds).toEqual(['r1']);
        expect(res.criteria).toEqual(['Requiere revisión de seguridad']);
    });

    it('does not match when the agent domain differs or is missing', async () => {
        for (const dom of ['finance', undefined]) {
            const ex = new PlanExecutor({ config: withDomain(dom), dispatchFn: tracker().dispatchFn, reflection: adapter([rule()]) });
            expect(isGate(await ex.execute(plan(st('t1', { agent_id: 'd' }))))).toBe(false);
        }
    });

    it('keyword rule without domain matches task text case-insensitively', async () => {
        const kw = rule({ if: { keywords: ['Refund'] }, then: { mustInclude: ['receipt'] } });
        const ex = new PlanExecutor({ config: config(), dispatchFn: tracker().dispatchFn, reflection: adapter([kw]) });
        const hit = await ex.execute(plan(st('t1', { task: 'process the REFUND now' }))) as GateHit;
        expect(hit.criteria).toEqual(['Debe incluir: receipt']);
        const ex2 = new PlanExecutor({ config: config(), dispatchFn: tracker().dispatchFn, reflection: adapter([kw]) });
        expect(isGate(await ex2.execute(plan(st('t1', { task: 'unrelated' }))))).toBe(false);
    });

    it('a rule with neither domain nor keywords is ignored (too broad)', async () => {
        const broad = rule({ if: {} });
        const ex = new PlanExecutor({ config: config(), dispatchFn: tracker().dispatchFn, reflection: adapter([broad]) });
        expect(isGate(await ex.execute(plan(st('t1'))))).toBe(false);
    });

    it('a failing reflection adapter is non-fatal: the plan just runs without rules', async () => {
        const ex = new PlanExecutor({ config: config(), dispatchFn: tracker().dispatchFn, reflection: adapter(new Error('db down')) });
        expect(isGate(await ex.execute(plan(st('t1'))))).toBe(false);
    });
});

describe('ruleToGateCriteria', () => {
    const base = { id: 'r', name: 'Named', trigger: { domain: 'd', pattern: 'p', minOccurrences: 1 }, if: {} } as const;

    it('lists every requirement', () => {
        const out = ruleToGateCriteria({ ...base, then: {
            mustInclude: ['a'], mustPass: ['b'], mustExecute: ['c'],
            requireArchitectureReview: true, requireSecurityReview: true, requireQaApproval: true,
        } });
        expect(out).toEqual([
            'Debe incluir: a', 'Debe cumplir: b', 'Debe ejecutar: c',
            'Requiere revisión de arquitectura', 'Requiere revisión de seguridad', 'Requiere aprobación de QA',
        ]);
    });

    it('falls back to a generic criterion naming the policy', () => {
        expect(ruleToGateCriteria({ ...base, then: {} })).toEqual(['Política "Named" aplicada — revisión requerida']);
    });
});

describe('subtask isolation', () => {
    it('a rejecting dispatch fails only that step; siblings keep their results', async () => {
        const ex = new PlanExecutor({
            config: config(),
            dispatchFn: async (subtask) => {
                if (subtask.id === 't1') throw new Error('queue down');
                return { subtask_id: subtask.id, agent_id: subtask.agent_id, task: subtask.task, result: 'ok', success: true, duration_ms: 1 };
            },
        });
        const res = await ex.execute(plan(st('t1'), st('t2'))) as PlanExecution;
        const byId = Object.fromEntries(res.results.map(r => [r.subtask_id, r]));
        expect(byId.t1).toMatchObject({ success: false, result: 'Error: queue down' });
        expect(byId.t2).toMatchObject({ success: true, result: 'ok' });
    });

    it('a hung step fails at subtaskTimeoutMs without discarding its siblings', async () => {
        const ex = new PlanExecutor({
            config: config(),
            subtaskTimeoutMs: 50,
            dispatchFn: (subtask) => subtask.id === 't1'
                ? new Promise(() => {})
                : Promise.resolve({ subtask_id: subtask.id, agent_id: subtask.agent_id, task: subtask.task, result: 'ok', success: true, duration_ms: 1 }),
        });
        const res = await ex.execute(plan(st('t1'), st('t2'))) as PlanExecution;
        const byId = Object.fromEntries(res.results.map(r => [r.subtask_id, r]));
        expect(byId.t1.success).toBe(false);
        expect(byId.t1.result).toMatch(/timed out after 50ms/);
        expect(byId.t2.success).toBe(true);
    });
});
