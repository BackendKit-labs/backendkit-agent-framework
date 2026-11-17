import { FlowHost } from '../host';
import { flowFromDefinition, flowRunView } from '../adapter';
import { MemoryRunJournal } from '../journal';
import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { FlowDefinitionSchema } from '../types';
import { stepApprovalId } from '../approval';
import { MemoryApprovalStore } from '../../governance/approval-store';

const def = FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: [
        { id: 'a', agent: 'x', prompt: 'a' },
        { id: 'b', agent: 'x', prompt: 'b' },
        { id: 'c', agent: 'x', prompt: 'c', after: ['a', 'b'] },
    ],
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('flowFromDefinition in a FlowHost', () => {
    it('shows parallel steps running together and done in the end', async () => {
        let release!: () => void;
        const hold = new Promise<void>(r => { release = r; });
        const executor: StepExecutor = { run: async (s) => { if (s.id !== 'c') await hold; return { content: `out-${s.id}` }; } };
        const host = new FlowHost({ f: flowFromDefinition(def, { executor }) });
        const { flowRunId } = await host.start('f', { who: 'ana' });
        await sleep(30);
        const mid = await host.status(flowRunId);
        expect(mid.steps.map(s => s.status)).toEqual(['running', 'running', 'pending']);
        release();
        await sleep(50);
        const end = await host.status(flowRunId);
        expect(end.status).toBe('done');
        expect(end.steps.map(s => s.status)).toEqual(['done', 'done', 'done']);
        expect(end.output).toBe('out-c');
    });

    it('pause holds steps not yet started; resume continues', async () => {
        const started: string[] = [];
        const executor: StepExecutor = { run: async (s) => { started.push(s.id); await sleep(20); return { content: '' }; } };
        const host = new FlowHost({ f: flowFromDefinition(def, { executor }) });
        const { flowRunId } = await host.start('f', {});
        await sleep(5);
        await host.pause(flowRunId);
        await sleep(80);
        expect((await host.status(flowRunId)).status).toBe('paused');
        expect(started).not.toContain('c');
        await host.resume(flowRunId);
        await sleep(80);
        expect((await host.status(flowRunId)).status).toBe('done');
        expect(started).toContain('c');
    });

    it('cancel aborts the running steps and reports cancelled', async () => {
        const executor: StepExecutor = {
            run: (_s, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new Error('aborted')))),
        };
        const host = new FlowHost({ f: flowFromDefinition(def, { executor }) });
        const { flowRunId } = await host.start('f', {});
        await sleep(10);
        const r = await host.cancel(flowRunId);
        expect(r.status).toBe('cancelled');
    });

    it('a failed step makes the hosted run failed, with the step in the error', async () => {
        const executor: StepExecutor = { run: async (s) => { if (s.id === 'a') throw new Error('boom'); return { content: '' }; } };
        const host = new FlowHost({ f: flowFromDefinition(def, { executor }) });
        const { flowRunId } = await host.start('f', {});
        await sleep(50);
        const r = await host.status(flowRunId);
        expect(r.status).toBe('failed');
        expect(r.error).toContain('step "a" failed: boom');
        expect(r.steps.find(s => s.name === 'c')!.status).toBe('skipped');
    });
});

describe('flowRunView', () => {
    it('projects a journal run, in declared step order', async () => {
        const journal = new MemoryRunJournal();
        const executor: StepExecutor = { run: async (s) => ({ content: `out-${s.id}` }) };
        await runFlow(def, { executor, journal, runId: 'v1' });
        const v = flowRunView((await journal.get('v1'))!, ['a', 'b', 'c']);
        expect(v).toMatchObject({ flowRunId: 'v1', flow: 'f', status: 'done', output: 'out-c' });
        expect(v.steps.map(s => s.name)).toEqual(['a', 'b', 'c']);
        expect(v.finishedAt).toBeDefined();
    });

    it('from protocol 1.2 the new states are sent as they are', async () => {
        const journal = new MemoryRunJournal();
        await journal.begin({ runId: 'v3', flow: 'f', inputPreview: '' });
        await journal.step('v3', 'a', { status: 'awaiting_approval', attempt: 1 });
        await journal.update('v3', { status: 'awaiting_approval', waiting: { stepId: 'a', approvalId: 'ap1' } });
        const v = flowRunView((await journal.get('v3'))!, ['a', 'b'], { protocolMinor: 2 });
        expect(v.status).toBe('awaiting_approval');
        expect(v.steps[0]).toEqual({ name: 'a', status: 'awaiting_approval' });
        await journal.step('v3', 'a', { status: 'interrupted', error: 'died' });
        await journal.update('v3', { status: 'lost', waiting: null });
        const lost = flowRunView((await journal.get('v3'))!, ['a'], { protocolMinor: 2 });
        expect(lost.status).toBe('lost');
        expect(lost.steps[0].status).toBe('interrupted');
        expect(lost.error).toBeUndefined();
    });

    it('awaiting_approval shows as paused, lost as failed, interrupted step as failed', async () => {
        const journal = new MemoryRunJournal();
        await journal.begin({ runId: 'v2', flow: 'f', inputPreview: '' });
        await journal.step('v2', 'a', { status: 'awaiting_approval', attempt: 1 });
        await journal.update('v2', { status: 'awaiting_approval', waiting: { stepId: 'a', approvalId: 'ap1' } });
        const paused = flowRunView((await journal.get('v2'))!, ['a', 'b']);
        expect(paused.status).toBe('paused');
        expect(paused.currentStep).toBe('a');
        expect(paused.steps).toEqual([{ name: 'a', status: 'running', detail: 'awaiting approval' }, { name: 'b', status: 'pending' }]);

        await journal.step('v2', 'a', { status: 'interrupted', error: 'died' });
        await journal.update('v2', { status: 'lost', waiting: null });
        const lost = flowRunView((await journal.get('v2'))!);
        expect(lost.status).toBe('failed');
        expect(lost.error).toBe('lost');
        expect(lost.steps[0]).toEqual({ name: 'a', status: 'failed', detail: 'died' });
    });
});

describe('flowFromDefinition with a human gate in a FlowHost', () => {
    const gated = FlowDefinitionSchema.parse({
        flow: 'g', trigger: { type: 'manual' },
        steps: [
            { id: 'a', agent: 'x', prompt: 'a' },
            { id: 'pay', agent: 'x', prompt: 'pay', after: ['a'], gate: { approval: 'human' } },
            { id: 'c', agent: 'x', prompt: 'c', after: ['pay'] },
        ],
    });
    const setup = () => {
        const ran: string[] = [];
        const executor: StepExecutor = { run: async (s) => { ran.push(s.id); return { content: `out-${s.id}` }; } };
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const host = new FlowHost({ g: flowFromDefinition(gated, { executor, journal, approvals: { store } }) });
        return { ran, store, journal, host };
    };

    it('waits for the person as awaiting_approval (not failed), under the id of the run, and goes on after the decision', async () => {
        const { ran, store, journal, host } = setup();
        const { flowRunId } = await host.start('g', {});
        await sleep(60);
        const v = await host.status(flowRunId);
        expect(v.status).toBe('awaiting_approval');
        expect(v.currentStep).toBe('pay');
        expect(v.steps.map(s => s.status)).toEqual(['done', 'awaiting_approval', 'pending']);
        expect(v.steps[1].detail).toBe(`approval ${stepApprovalId(flowRunId, 'pay')}`);
        expect(v.error).toBeUndefined();
        expect((await journal.get(flowRunId))!.status).toBe('awaiting_approval'); // the journal is keyed by the host's id
        expect((await store.list({ status: 'pending' })).map(a => a.id)).toEqual([stepApprovalId(flowRunId, 'pay')]);

        await host.resume(flowRunId); // not decided yet: it waits again, nothing else runs
        await sleep(60);
        expect((await host.status(flowRunId)).status).toBe('awaiting_approval');
        expect(ran).toEqual(['a']);

        await store.resolve(stepApprovalId(flowRunId, 'pay'), { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
        await host.resume(flowRunId);
        await sleep(80);
        const end = await host.status(flowRunId);
        expect(end.status).toBe('done');
        expect(end.steps.map(s => s.status)).toEqual(['done', 'done', 'done']);
        expect(ran).toEqual(['a', 'pay', 'c']); // a was not run again
    });

    it('can be cancelled while it waits', async () => {
        const { host } = setup();
        const { flowRunId } = await host.start('g', {});
        await sleep(60);
        expect((await host.cancel(flowRunId)).status).toBe('cancelled');
    });
});
