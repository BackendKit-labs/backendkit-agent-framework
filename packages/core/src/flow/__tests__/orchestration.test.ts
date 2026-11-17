import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { MemoryRunJournal } from '../journal';
import { stepApprovalId } from '../approval';
import { flowFromTaskPlan, flowFromStaticFlow } from '../convert';
import { FlowDefinitionSchema } from '../types';
import { MemoryApprovalStore } from '../../governance/approval-store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const human = { kind: 'human' as const, id: 'ana' };

const chain = (extra: Record<string, unknown> = {}) => FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: [
        { id: 'a', agent: 'x', prompt: 'a', ...extra },
        { id: 'b', agent: 'x', prompt: 'b', after: ['a'] },
    ],
});

describe('onStepFailure', () => {
    const failA: StepExecutor = { run: async (s) => { if (s.id === 'a') throw new Error('boom'); return { content: `out-${s.id}` }; } };

    it('skip (default): the steps that wait for it are skipped', async () => {
        const r = await runFlow(chain(), { executor: failA });
        expect(r.steps.b.status).toBe('skipped');
    });

    it('continue: they run without its output, and the run still ends failed', async () => {
        const ctx: Record<string, string | undefined> = {};
        const executor: StepExecutor = { run: async (s, i) => { ctx[s.id] = i.context; return failA.run(s, i); } };
        const r = await runFlow(chain(), { executor, onStepFailure: 'continue' });
        expect(r.steps.a.status).toBe('failed');
        expect(r.steps.b.status).toBe('completed');
        expect(ctx.b).toBeUndefined();
        expect(r.status).toBe('failed');
    });
});

describe('step deadline', () => {
    it('fails a slow step, aborts its signal, and does not hold up its siblings', async () => {
        let aborted = false;
        const executor: StepExecutor = {
            run: async (s, i) => {
                if (s.id === 'slow') {
                    i.signal.addEventListener('abort', () => { aborted = true; });
                    await sleep(500);
                }
                return { content: 'ok' };
            },
        };
        const def = FlowDefinitionSchema.parse({
            flow: 'f', trigger: { type: 'manual' },
            steps: [{ id: 'slow', agent: 'x', prompt: 's', timeoutMs: 30 }, { id: 'fast', agent: 'x', prompt: 'f' }],
        });
        const r = await runFlow(def, { executor });
        expect(r.steps.slow).toMatchObject({ status: 'failed', error: 'timed out after 30ms' });
        expect(r.steps.fast.status).toBe('completed');
        expect(aborted).toBe(true);
        expect(r.status).toBe('failed');
    });

    it('stepTimeoutMs is the default for steps without their own', async () => {
        const executor: StepExecutor = { run: async () => { await sleep(200); return { content: '' }; } };
        const r = await runFlow(chain(), { executor, stepTimeoutMs: 20 });
        expect(r.steps.a.error).toBe('timed out after 20ms');
    });
});

describe('approval after the step (a person reviews the output)', () => {
    function counting() {
        const ran: string[] = [];
        const executor: StepExecutor = { run: async (s) => { ran.push(s.id); return { content: `out-${s.id}` }; } };
        return { ran, executor };
    }
    const gated = chain({ gate: { approval: 'human', criteria: ['is correct'] } });

    it('runs the step, keeps its output for the reviewer, holds the next steps, and resumes without rerunning', async () => {
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const { ran, executor } = counting();
        const approvals = { store, when: 'after' as const };

        const first = await runFlow(gated, { executor, journal, runId: 'r1', approvals });
        expect(first.status).toBe('awaiting_approval');
        expect(ran).toEqual(['a']);
        const run = (await journal.get('r1'))!;
        expect(run.steps.a).toMatchObject({ status: 'awaiting_approval', output: 'out-a' });
        const [req] = await store.list({ status: 'pending' });
        expect(req.subject).toMatchObject({ kind: 'workflow_step', step: 'a', input: { output: 'out-a' } });

        await store.resolve(stepApprovalId('r1', 'a'), { decision: 'approve', by: human, at: new Date().toISOString() });
        const second = await runFlow(gated, { executor, journal, runId: 'r1', approvals });
        expect(second.status).toBe('completed');
        expect(ran).toEqual(['a', 'b']); // a was not run again
        expect(second.steps.a.content).toBe('out-a');
    });

    it('a rejection fails the step, skips the rest, and fails the run', async () => {
        const store = new MemoryApprovalStore();
        const { ran, executor } = counting();
        const approver = { request: async () => ({ decision: 'reject' as const, by: human, reason: 'wrong data', at: new Date().toISOString() }) };
        const r = await runFlow(gated, { executor, approvals: { store, approver, when: 'after' } });
        expect(ran).toEqual(['a']);
        expect(r.steps.a.status).toBe('rejected');
        expect(r.steps.b.status).toBe('skipped');
        expect(r.status).toBe('rejected');
    });

    it('an in-process approver reviews inline and the run completes', async () => {
        const store = new MemoryApprovalStore();
        const { executor } = counting();
        const seen: unknown[] = [];
        const approver = { request: async (req: { subject: unknown }) => { seen.push(req.subject); return { decision: 'approve' as const, by: human, at: new Date().toISOString() }; } };
        const r = await runFlow(gated, { executor, approvals: { store, approver, when: 'after' } });
        expect(r.status).toBe('completed');
        expect(seen[0]).toMatchObject({ input: { output: 'out-a' } });
    });
});

describe('converters', () => {
    it('flowFromTaskPlan: depends_on -> after, gate -> human approval with its criteria', () => {
        const def = flowFromTaskPlan({
            summary: 'Cerrar el mes',
            subtasks: [
                { id: 's1', agent_id: 'conta', task: 'Cuadrar {{payload.mes}}', depends_on: [], gate: true, gate_criteria: ['cuadra'] },
                { id: 's2', agent_id: 'audit', task: 'Revisar', depends_on: ['s1'], gate_criteria: ['ignored without gate'] },
            ],
        });
        expect(def.flow).toBe('Cerrar el mes');
        expect(def.trigger).toEqual({ type: 'manual' });
        expect(def.steps[0]).toMatchObject({ id: 's1', agent: 'conta', prompt: 'Cuadrar {{payload.mes}}', after: [], gate: { approval: 'human', criteria: ['cuadra'] } });
        expect(def.steps[1]).toMatchObject({ id: 's2', after: ['s1'] });
        expect(def.steps[1].gate).toBeUndefined();
    });

    it('flowFromStaticFlow converts the orchestrator flow files (flows/onboarding-empleado.yaml)', () => {
        const file = path.resolve(__dirname, '../../../../orchestrator-agent/flows/onboarding-empleado.yaml');
        if (!fs.existsSync(file)) return; // package not present in this checkout
        const raw = yaml.parse(fs.readFileSync(file, 'utf8'));
        const def = flowFromStaticFlow(raw);
        expect(def.flow).toBe('onboarding-empleado');
        expect(def.steps.length).toBe(raw.steps.length);
        expect(def.steps[0]).toMatchObject({ id: 's1-hr-checklist', agent: 'hr-agent', gate: { approval: 'human' } });
        for (const s of def.steps) expect(s.after).toEqual(raw.steps.find((x: { id: string }) => x.id === s.id).depends_on ?? []);
    });

    it('a plan with an unknown dependency still converts (the engine reports it as failed)', async () => {
        const def = flowFromTaskPlan({ summary: 'x', subtasks: [{ id: 'a', agent_id: 'x', task: 't', depends_on: ['nope'] }] });
        const r = await runFlow(def, { executor: { run: async () => ({ content: '' }) } });
        expect(r.steps.a.status).toBe('failed');
    });
});
