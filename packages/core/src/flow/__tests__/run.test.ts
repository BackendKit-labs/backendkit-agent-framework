import { runFlow } from '../run';
import type { StepExecutor, StepInput } from '../run';
import { KeyedConcurrencyLimiter } from '../limiter';
import { interpolate } from '../interpolate';
import { FlowDefinitionSchema } from '../types';
import type { FlowDefinition } from '../types';
import { createMockTransport } from '../../__tests__/helpers';

function step(id: string, after: string[] = [], extra: Record<string, unknown> = {}) {
    return { id, agent: `agent-${id}`, prompt: `Do ${id}`, after, ...extra };
}

function flow(steps: ReturnType<typeof step>[], compensation: unknown[] = []): FlowDefinition {
    return FlowDefinitionSchema.parse({ flow: 't', trigger: { type: 'manual' }, steps, compensation });
}

const ok = (): StepExecutor => ({ run: async (s) => ({ content: `result-${s.id}` }) });

describe('runFlow', () => {
    it('single step completes', async () => {
        const r = await runFlow(flow([step('a')]), { executor: ok() });
        expect(r.status).toBe('completed');
        expect(r.steps.a.content).toBe('result-a');
    });

    it('dependent step gets the previous output as context; first gets none', async () => {
        const ctx: Record<string, string | undefined> = {};
        const executor: StepExecutor = { run: async (s, i) => { ctx[s.id] = i.context; return { content: 'ok' }; } };
        await runFlow(flow([step('a'), step('b', ['a'])]), { executor });
        expect(ctx.a).toBeUndefined();
        expect(ctx.b).toContain('[a]');
    });

    it('a failure skips the whole chain', async () => {
        const ran: string[] = [];
        const executor: StepExecutor = { run: async (s) => { ran.push(s.id); if (s.id === 'a') throw new Error('boom'); return { content: 'x' }; } };
        const r = await runFlow(flow([step('a'), step('b', ['a']), step('c', ['b'])]), { executor });
        expect(r.status).toBe('failed');
        expect(r.steps.a.status).toBe('failed');
        expect(r.steps.b.status).toBe('skipped');
        expect(r.steps.c.status).toBe('skipped');
        expect(ran).toEqual(['a']);
    });

    it('a cycle in an unvalidated definition is reported as failed', async () => {
        const r = await runFlow(flow([step('a', ['b']), step('b', ['a']), step('ok')]), { executor: ok() });
        expect(r.status).toBe('failed');
        expect(r.steps.ok.status).toBe('completed');
        expect(r.steps.a.error).toMatch(/Unsatisfiable dependencies/);
        expect(Object.keys(r.steps).sort()).toEqual(['a', 'b', 'ok']);
    });

    it('interpolates the payload into the prompt', async () => {
        const seen: string[] = [];
        const executor: StepExecutor = { run: async (_s, i) => { seen.push(i.prompt); return { content: '' }; } };
        const def = flow([{ ...step('a'), prompt: 'Hola {{payload.name}}' }]);
        await runFlow(def, { executor, payload: { name: 'Ana' } });
        expect(seen).toEqual(['Hola Ana']);
        expect(interpolate('{{payload.x.y}}', {})).toBe('null');
    });

    it('human approval: runs when approved, rejects dependents when not', async () => {
        const gated = [step('a', [], { gate: { approval: 'human' } }), step('b', ['a'])];
        const approved = await runFlow(flow(gated), { executor: ok(), approve: async () => true });
        expect(approved.status).toBe('completed');
        const rejected = await runFlow(flow(gated), { executor: ok(), approve: async () => false });
        expect(rejected.status).toBe('rejected');
        expect(rejected.steps.a.status).toBe('rejected');
        expect(rejected.steps.b.status).toBe('skipped');
    });

    it('human approval fails closed (ADR-0010): no approver, an answer that is not true, or an approver that throws reject', async () => {
        const gated = [step('a', [], { gate: { approval: 'human' } }), step('b', ['a'])];
        const ran: string[] = [];
        const executor = { run: async (s: { id: string }) => { ran.push(s.id); return { content: 'x' }; } };
        const none = await runFlow(flow(gated), { executor });
        expect(none.steps.a.status).toBe('rejected');
        expect(none.steps.b.status).toBe('skipped');
        expect(none.transitions.find(t => t.stepId === 'a' && t.event === 'rejected')?.detail).toMatch(/no approver/);
        const vague = await runFlow(flow(gated), { executor, approve: (async () => undefined) as never });
        expect(vague.steps.a.status).toBe('rejected');
        const broken = await runFlow(flow(gated), { executor, approve: async () => { throw new Error('ui down'); } });
        expect(broken.steps.a.status).toBe('rejected');
        expect(broken.transitions.find(t => t.stepId === 'a' && t.event === 'rejected')?.detail).toMatch(/approver failed/);
        expect(ran).toEqual([]);
    });

    it('a gate nothing can evaluate fails the step before it runs (ADR-0010); a person reviewing criteria is enough', async () => {
        const ran: string[] = [];
        const executor = { run: async (s: { id: string }) => { ran.push(s.id); return { content: 'x' }; } };
        const byAgent = await runFlow(flow([step('a', [], { gate: { evaluator: 'auditor', criteria: ['balances'] } })]), { executor });
        expect(byAgent.steps.a.status).toBe('failed');
        expect(byAgent.steps.a.error).toMatch(/no gate function/);
        const unreviewed = await runFlow(flow([step('a', [], { gate: { criteria: ['balances'] } })]), { executor });
        expect(unreviewed.steps.a.status).toBe('failed');
        expect(ran).toEqual([]);
        const byPerson = await runFlow(flow([step('a', [], { gate: { approval: 'human', criteria: ['balances'] } })]), { executor, approve: async () => true });
        expect(byPerson.steps.a.status).toBe('completed');
    });

    it('a gate hook that throws fails the step and records what it logged', async () => {
        const def = flow([step('a', [], { gate: { criteria: ['c'], evaluator: 'x' } })]);
        const r = await runFlow(def, {
            executor: ok(),
            gate: async (_s, _o, ctx) => { ctx.record('gate_failed', 'nope'); throw new Error('gate did not pass'); },
        });
        expect(r.status).toBe('failed');
        expect(r.transitions.map(t => t.event)).toEqual(['started', 'gate_failed', 'failed']);
    });

    it('compensation runs after the flow, in declared order, only for failed steps', async () => {
        const order: string[] = [];
        const executor: StepExecutor = {
            run: async (s) => { order.push(s.id); if (s.id === 'a') throw new Error('boom'); return { content: 'x' }; },
        };
        const def = flow([step('a'), step('b')], [
            { on: 'a.failed', agent: 'undo', prompt: 'undo a' },
            { on: 'b.failed', agent: 'undo', prompt: 'undo b' },
        ]);
        const r = await runFlow(def, { executor });
        expect(r.compensations).toHaveLength(1);
        expect(r.compensations[0]).toMatchObject({ on: 'a.failed', status: 'completed' });
        expect(order[order.length - 1]).toBe('a:compensation');
    });

    it('emits workflow_start / workflow_complete on the transport', async () => {
        const { transport, events } = createMockTransport();
        await runFlow(flow([step('x')]), { executor: ok(), transport });
        expect(events.some(e => e.type === 'workflow_start')).toBe(true);
        expect(events.some(e => e.type === 'workflow_complete')).toBe(true);
    });

    it('gives each step an idempotency key runId:stepId:attempt', async () => {
        const keys: string[] = [];
        const executor: StepExecutor = { run: async (_s, i: StepInput) => { keys.push(i.idempotencyKey); return { content: '' }; } };
        await runFlow(flow([step('a')]), { executor, runId: 'r1' });
        expect(keys).toEqual(['r1:a:1']);
    });
});

describe('runFlow: concurrency', () => {
    const wide = (n: number) => flow(Array.from({ length: n }, (_, i) => step(`s${i}`)));

    function peakExecutor() {
        let running = 0;
        const state = { peak: 0 };
        const executor: StepExecutor = {
            run: async () => {
                running++; state.peak = Math.max(state.peak, running);
                await new Promise(r => setTimeout(r, 10));
                running--;
                return { content: 'x' };
            },
        };
        return { executor, state };
    }

    it('caps a wave at maxConcurrency; default 8', async () => {
        const a = peakExecutor();
        await runFlow(wide(10), { executor: a.executor, maxConcurrency: 3 });
        expect(a.state.peak).toBe(3);
        const b = peakExecutor();
        await runFlow(wide(20), { executor: b.executor });
        expect(b.state.peak).toBe(8);
    });

    it('a shared limiter caps per agent across flows', async () => {
        const { executor, state } = peakExecutor();
        const limiter = new KeyedConcurrencyLimiter({ max: 2 });
        const sameAgent = (n: number) => flow(Array.from({ length: n }, (_, i) => ({ ...step(`s${i}`), agent: 'shared' })));
        await Promise.all([
            runFlow(sameAgent(5), { executor, limiter }),
            runFlow(sameAgent(5), { executor, limiter }),
        ]);
        expect(state.peak).toBe(2);
    });

    it('tenantId adds a cap per tenant', async () => {
        const { executor, state } = peakExecutor();
        const limiter = new KeyedConcurrencyLimiter({ max: k => (k.startsWith('tenant:') ? 1 : undefined) });
        await runFlow(wide(5), { executor, limiter, tenantId: 't1' });
        expect(state.peak).toBe(1);
    });
});

describe('runFlow: control', () => {
    it('abort stops new steps, passes the signal, and ends cancelled without running compensations', async () => {
        const ac = new AbortController();
        const ran: string[] = [];
        const executor: StepExecutor = {
            run: async (s, i) => {
                ran.push(s.id);
                if (s.id === 'a') {
                    await new Promise((_, rej) => { i.signal.addEventListener('abort', () => rej(new Error('x'))); ac.abort(); });
                }
                return { content: '' };
            },
        };
        const def = flow([step('a'), step('b', ['a'])], [{ on: 'a.failed', agent: 'undo', prompt: 'u' }]);
        const r = await runFlow(def, { executor, signal: ac.signal });
        expect(r.status).toBe('cancelled');
        expect(ran).toEqual(['a']);
        expect(r.steps.b).toBeUndefined();
        expect(r.compensations).toEqual([]);
    });

    it('checkpoint is awaited before each step (pause)', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const started: string[] = [];
        const executor: StepExecutor = { run: async (s) => { started.push(s.id); return { content: '' }; } };
        const p = runFlow(flow([step('a')]), { executor, checkpoint: () => gate });
        await new Promise(r => setTimeout(r, 20));
        expect(started).toEqual([]);
        release();
        const r = await p;
        expect(r.status).toBe('completed');
        expect(started).toEqual(['a']);
    });
});
