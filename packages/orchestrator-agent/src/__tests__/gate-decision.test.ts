import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyGateDecision, type GateDecisionDeps } from '../gate-decision.js';
import { RunStore } from '../run-store.js';
import type { RunState } from '../run-store.js';
import type { OrchestratorConfig } from '../config.js';

let dir: string;
let store: RunStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')); store = new RunStore(path.join(dir, 'runs')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const config = (vault = false) => ({ orchestrator: vault ? { vault: { path: '/vault', embedder: 'simple' } } : {} }) as unknown as OrchestratorConfig;

const waiting = (over: Partial<RunState> = {}): RunState => ({
    runId: 'run-1-abc', task: 'ship it', configPath: 'c.yaml', status: 'waiting_gate',
    startedAt: '2026-10-26T00:00:00.000Z', updatedAt: '', plan: { summary: 's', subtasks: [] },
    completedSteps: [{ stepId: 't1', agentId: 'dev', task: 'build', output: 'built', success: true, durationMs: 5 }],
    waitingGate: { gateId: 't2', stepId: 't2', agentId: 'qa', output: 'looks fine', criteria: ['check X'], requestedAt: '2026-10-26T00:00:01.000Z', appliedRuleIds: ['r1', 'r2'] },
    ...over,
});

function deps(over: Partial<GateDecisionDeps> = {}) {
    const audit: unknown[] = [];
    const outcomes: Array<[string, string]> = [];
    const resumed: unknown[][] = [];
    const base: GateDecisionDeps = {
        audit: { write: e => { audit.push(e); } },
        getReflection: async () => ({ recordRuleOutcome: async (id, o) => { outcomes.push([id, o]); } }),
        buildRAG: async () => ({ search: async () => 'rag' }),
        dataDir: () => path.join(dir, 'data'),
        resume: async (...args) => { resumed.push(args); },
        now: () => '2026-10-26T12:00:00.000Z',
    };
    return { deps: { ...base, ...over }, audit, outcomes, resumed };
}

const tick = () => new Promise<void>(r => setImmediate(r));

describe('applyGateDecision — reject', () => {
    it('fails the run, clears the gate, writes the audit entry and never resumes', async () => {
        const s = waiting(); await store.save(s);
        const d = deps();
        const { gate } = await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: false, notes: 'too risky' }, d.deps);
        await tick();

        expect(gate.stepId).toBe('t2');
        const saved = (await store.load(s.runId))!;
        expect(saved.status).toBe('failed');
        expect(saved.waitingGate).toBeUndefined();
        expect(saved.completedAt).toBe('2026-10-26T12:00:00.000Z');
        expect(saved.error).toBe('Gate rejected by approver. Step: t2. Notes: too risky');
        expect(d.audit).toEqual([{ event: 'gate.rejected', runId: s.runId, task: 'ship it', stepId: 't2', agentId: 'qa', error: 'too risky' }]);
        expect(d.resumed).toHaveLength(0);
    });

    it('records "(none)" / "no notes" when the approver gave none', async () => {
        const s = waiting(); await store.save(s);
        const d = deps();
        await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: false }, d.deps);
        expect((await store.load(s.runId))!.error).toContain('Notes: (none)');
        expect(d.audit[0]).toMatchObject({ error: 'no notes' });
    });
});

describe('applyGateDecision — approve', () => {
    it('marks the run running, audits, and resumes in the background with the prior results', async () => {
        const s = waiting(); await store.save(s);
        const d = deps();
        await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: true, notes: 'ok' }, d.deps);

        const saved = (await store.load(s.runId))!;
        expect(saved.status).toBe('running');
        expect(saved.waitingGate).toBeUndefined();
        expect(d.audit).toEqual([{ event: 'gate.approved', runId: s.runId, task: 'ship it', stepId: 't2', agentId: 'qa', extra: { notes: 'ok' } }]);

        expect(d.resumed).toHaveLength(0);   // resumed after the decision returns, not inline
        await tick();
        expect(d.resumed).toHaveLength(1);
        const [runId, configPath, , plan, rag, prior] = d.resumed[0] as [string, string, unknown, unknown, { search: unknown }, unknown[]];
        expect([runId, configPath]).toEqual([s.runId, 'c.yaml']);
        expect(plan).toEqual({ summary: 's', subtasks: [] });
        expect(rag).not.toBeNull();
        expect(prior).toEqual([{ subtask_id: 't1', agent_id: 'dev', task: 'build', result: 'built', success: true, duration_ms: 5 }]);
    });

    it('omits `extra` from the audit entry when there are no notes', async () => {
        const s = waiting(); await store.save(s);
        const d = deps();
        await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: true }, d.deps);
        expect(d.audit[0]).toMatchObject({ event: 'gate.approved', extra: undefined });
    });

    it('a RAG that fails to build does not block the resume (null is passed)', async () => {
        const s = waiting(); await store.save(s);
        const d = deps({ buildRAG: async () => { throw new Error('ollama down'); } });
        await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: true }, d.deps);
        await tick();
        expect(d.resumed[0][4]).toBeNull();
    });

    it('a resume that throws marks the run failed instead of leaving it running', async () => {
        const s = waiting(); await store.save(s);
        const d = deps({ resume: async () => { throw new Error('boom'); } });
        await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(), store, state: s, approved: true }, d.deps);
        await tick(); await tick();
        const saved = (await store.load(s.runId))!;
        expect(saved.status).toBe('failed');
        expect(saved.error).toContain('boom');
    });
});

describe('applyGateDecision — policy rule outcomes (reflection)', () => {
    it('reports success for every applied rule on approve and failure on reject', async () => {
        for (const [approved, expected] of [[true, 'success'], [false, 'failure']] as const) {
            const s = waiting(); await store.save(s);
            const d = deps();
            await applyGateDecision({ runId: s.runId, configPath: 'c.yaml', config: config(true), store, state: s, approved }, d.deps);
            expect(d.outcomes).toEqual([['r1', expected], ['r2', expected]]);
        }
    });

    it('does nothing without a vault, without applied rules, or when the reflection cannot be loaded', async () => {
        const noVault = deps(); const s1 = waiting(); await store.save(s1);
        await applyGateDecision({ runId: s1.runId, configPath: 'c.yaml', config: config(false), store, state: s1, approved: true }, noVault.deps);
        expect(noVault.outcomes).toEqual([]);

        const noRules = deps(); const s2 = waiting({ runId: 'run-2-x', waitingGate: { ...waiting().waitingGate!, appliedRuleIds: undefined } }); await store.save(s2);
        await applyGateDecision({ runId: s2.runId, configPath: 'c.yaml', config: config(true), store, state: s2, approved: true }, noRules.deps);
        expect(noRules.outcomes).toEqual([]);

        const broken = deps({ getReflection: async () => { throw new Error('vault gone'); } }); const s3 = waiting({ runId: 'run-3-x' }); await store.save(s3);
        await expect(applyGateDecision({ runId: s3.runId, configPath: 'c.yaml', config: config(true), store, state: s3, approved: true }, broken.deps)).resolves.toBeDefined();
    });
});
