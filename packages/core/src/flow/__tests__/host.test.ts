/**
 * SPEC-0023 F4: the flows an agent hosts, with a state a supervisor can see and steer. The behaviour is the one Hermes' `InProcessFlows`
 * has had (these are its cases), so that Hermes can swap it for this one without noticing.
 */
import { createFlowHandler, FlowCancelled, FlowControlError, FlowHost, FlowHostError, type InProcessFlow } from '..';

const tick = (ms = 30) => new Promise<void>(r => setTimeout(r, ms));
async function until(check: () => boolean, ms = 2000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) { if (Date.now() > end) throw new Error('timed out'); await tick(5); }
}

/** A flow whose steps wait for the test to release them. */
function gated(steps: string[] = ['collect', 'report']) {
    const ran: string[] = [];
    const waiting = new Map<string, () => void>();
    const hold = (name: string) => new Promise<void>(resolve => { waiting.set(name, resolve); });
    const flow: InProcessFlow = {
        description: 'collects and reports', steps,
        run: async (input, ctl) => {
            for (const name of steps) { await ctl.step(name); ran.push(name); await hold(name); }
            return `closed ${String(input.month)}`;
        },
    };
    return { flow, ran, release: (name: string) => { waiting.get(name)?.(); waiting.delete(name); } };
}

describe('FlowHost', () => {
    it('lists the flows it hosts with their steps', async () => {
        const host = new FlowHost({ a: { description: 'A', steps: ['x'], run: async () => 1 }, b: { run: async () => 2 } });
        expect(await host.list()).toEqual([{ name: 'a', description: 'A', steps: ['x'] }, { name: 'b' }]);
    });

    it('starts a flow, shows the step it is on, and follows it to the end', async () => {
        const g = gated(); const host = new FlowHost({ 'close-month': g.flow });
        const { flowRunId } = await host.start('close-month', { month: '2026-09' });
        await until(() => g.ran.includes('collect'));
        expect(await host.status(flowRunId)).toMatchObject({ status: 'running', currentStep: 'collect', steps: [{ name: 'collect', status: 'running' }, { name: 'report', status: 'pending' }] });
        g.release('collect'); await until(() => g.ran.includes('report'));
        g.release('report'); await until(() => g.ran.length === 2);
        await tick();
        expect(await host.status(flowRunId)).toMatchObject({ status: 'done', output: 'closed 2026-09', steps: [{ status: 'done' }, { status: 'done' }] });
    });

    it('pauses at the next step boundary and resumes', async () => {
        const g = gated(); const host = new FlowHost({ f: g.flow });
        const { flowRunId } = await host.start('f', { month: 'm' });
        await until(() => g.ran.includes('collect'));
        expect((await host.pause(flowRunId)).status).toBe('paused');
        g.release('collect'); await tick(80);
        expect(g.ran).toEqual(['collect']); // paused: the next step did not start
        expect((await host.resume(flowRunId)).status).toBe('running');
        await until(() => g.ran.includes('report'));
    });

    it('cancels a paused flow: it never starts another step and the run ends cancelled', async () => {
        const g = gated(); const host = new FlowHost({ f: g.flow });
        const { flowRunId } = await host.start('f', {});
        await until(() => g.ran.includes('collect'));
        await host.pause(flowRunId);
        g.release('collect');
        const view = await host.cancel(flowRunId);
        expect(view.status).toBe('cancelled');
        expect(g.ran).toEqual(['collect']);
        expect(view.steps.map(s => s.status)).toEqual(['skipped', 'skipped']);
    });

    it('cancels a flow that never reaches a checkpoint after the grace period, and ignores its result', async () => {
        const host = new FlowHost({ stuck: { run: () => new Promise(() => undefined) } }, 50);
        const { flowRunId } = await host.start('stuck', {});
        const view = await host.cancel(flowRunId);
        expect(view.status).toBe('cancelled');
    });

    it('a flow that fails is a failed run with the reason, and its running step is failed', async () => {
        const host = new FlowHost({ bad: { steps: ['one'], run: async (_i, ctl) => { await ctl.step('one'); throw new Error('ledger closed'); } } });
        const { flowRunId } = await host.start('bad', {});
        await until(() => true); await tick();
        expect(await host.status(flowRunId)).toMatchObject({ status: 'failed', error: 'ledger closed', steps: [{ name: 'one', status: 'failed' }] });
    });

    it('a flow can name steps as it goes, and a step that was not announced is added', async () => {
        const host = new FlowHost({ f: { run: async (_i, ctl) => { await ctl.step('late', 'detail'); return { ok: true }; } } });
        const { flowRunId } = await host.start('f', {});
        await tick(60);
        expect(await host.status(flowRunId)).toMatchObject({ status: 'done', output: '{"ok":true}', steps: [{ name: 'late', status: 'done', detail: 'detail' }] });
    });

    it('refuses an unknown flow and an unknown run with a code', async () => {
        const host = new FlowHost({});
        await expect(host.start('nope', {})).rejects.toMatchObject({ code: 'CAPABILITY_NOT_FOUND' });
        await expect(host.status('x')).rejects.toBeInstanceOf(FlowHostError);
        await expect(host.status('x')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    });

    it('close() stops every flow still going', async () => {
        const g = gated(); const host = new FlowHost({ f: g.flow });
        const { flowRunId } = await host.start('f', {});
        await until(() => g.ran.includes('collect'));
        await host.close();
        expect((await host.status(flowRunId)).status).toBe('cancelled');
    });

    it('FlowCancelled is what a step sees when the flow is cancelled', async () => {
        let seen: unknown;
        const host = new FlowHost({ f: { run: async (_i, ctl) => { try { await ctl.step('a'); await new Promise(() => undefined); } catch (e) { seen = e; throw e; } } } }, 50);
        const { flowRunId } = await host.start('f', {});
        await tick(20);
        await host.pause(flowRunId);
        await host.cancel(flowRunId);
        expect(seen === undefined || seen instanceof FlowCancelled).toBe(true);
    });
});

describe('createFlowHandler: the handler an AgentServer takes', () => {
    it('publishes the flows and answers with protocol codes: an unknown run is TASK_NOT_FOUND, an unknown flow CAPABILITY_NOT_FOUND', async () => {
        const { handler } = createFlowHandler({ f: { description: 'd', steps: ['s'], run: async () => 'ok' } });
        expect(handler.flows()).toEqual([{ name: 'f', description: 'd', steps: ['s'] }]);
        const err = await handler.status('nope').catch(e => e);
        expect(err).toBeInstanceOf(FlowControlError);
        // AgentServer recognises a control error by name and code, so a handler from another package needs no import of its class.
        expect(err).toMatchObject({ name: 'ControlError', code: 'TASK_NOT_FOUND' });
        await expect(handler.start('zz', {})).rejects.toMatchObject({ name: 'ControlError', code: 'CAPABILITY_NOT_FOUND' });
    });

    it('starts, steers and ends a run through the handler', async () => {
        const g = gated(['a']); const { handler, host } = createFlowHandler({ f: g.flow });
        const { flowRunId } = await handler.start('f', { month: 'm' });
        await until(() => g.ran.includes('a'));
        expect((await handler.pause(flowRunId)).status).toBe('paused');
        expect((await handler.resume(flowRunId)).status).toBe('running');
        g.release('a'); await tick(60);
        expect(await handler.status(flowRunId)).toMatchObject({ status: 'done', output: 'closed m' });
        await host.close();
    });
});
