import { WorkflowRunner } from '../WorkflowRunner';
import type { WorkflowDef } from '../types';
import { createMockTransport } from '../../__tests__/helpers';

function makeStep(id: string, dependsOn: string[] = [], requireApproval = false) {
    return { id, agentId: `agent-${id}`, input: `Do ${id}`, dependsOn, requireApproval };
}

function makeRunner(def: WorkflowDef, agentResults: Record<string, string> = {}) {
    const { transport } = createMockTransport();
    const executionOrder: string[] = [];

    const runner = new WorkflowRunner(def, {
        transport,
        runAgent: async (agentId, input, _context) => {
            executionOrder.push(agentId);
            const stepId = agentId.replace('agent-', '');
            return { content: agentResults[stepId] ?? `result-${stepId}` };
        },
    });

    return { runner, executionOrder };
}

describe('WorkflowRunner', () => {
    it('single step: completes with status completed', async () => {
        const def: WorkflowDef = { name: 'test', steps: [makeStep('a')] };
        const { runner } = makeRunner(def);
        const result = await runner.run();
        expect(result.status).toBe('completed');
        expect(result.steps['a'].status).toBe('completed');
    });

    it('two independent steps both execute', async () => {
        const def: WorkflowDef = {
            name: 'parallel',
            steps: [makeStep('a'), makeStep('b')],
        };
        const { runner, executionOrder } = makeRunner(def);
        const result = await runner.run();
        expect(result.status).toBe('completed');
        expect(executionOrder).toContain('agent-a');
        expect(executionOrder).toContain('agent-b');
    });

    it('dependent step receives previous output as context', async () => {
        const def: WorkflowDef = {
            name: 'chain',
            steps: [makeStep('a'), makeStep('b', ['a'])],
        };
        const { transport } = createMockTransport();
        const receivedContexts: (string | undefined)[] = [];

        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async (_agentId, _input, context) => {
                receivedContexts.push(context);
                return { content: 'ok' };
            },
        });

        await runner.run();
        // Step a has no deps → no context; step b gets a's output
        expect(receivedContexts[0]).toBeUndefined();
        expect(receivedContexts[1]).toContain('[a]');
    });

    it('failed step causes dependent to be skipped', async () => {
        const def: WorkflowDef = {
            name: 'failure',
            steps: [makeStep('a'), makeStep('b', ['a'])],
        };
        const { transport } = createMockTransport();
        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async (agentId) => {
                if (agentId === 'agent-a') throw new Error('step a failed');
                return { content: 'ok' };
            },
        });

        const result = await runner.run();
        expect(result.status).toBe('failed');
        expect(result.steps['a'].status).toBe('failed');
        expect(result.steps['b'].status).toBe('skipped');
    });

    it('requireApproval: calls onApprovalRequired and runs when approved', async () => {
        const def: WorkflowDef = {
            name: 'approval',
            steps: [makeStep('a', [], true)],
        };
        const { transport } = createMockTransport();
        let approvalCalled = false;

        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async () => ({ content: 'done' }),
            onApprovalRequired: async () => { approvalCalled = true; return true; },
        });

        const result = await runner.run();
        expect(approvalCalled).toBe(true);
        expect(result.steps['a'].status).toBe('completed');
    });

    it('requireApproval: rejected step marks workflow as rejected', async () => {
        const def: WorkflowDef = {
            name: 'rejected',
            steps: [makeStep('a', [], true)],
        };
        const { transport } = createMockTransport();

        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async () => ({ content: 'done' }),
            onApprovalRequired: async () => false,
        });

        const result = await runner.run();
        expect(result.status).toBe('rejected');
        expect(result.steps['a'].status).toBe('rejected');
    });

    it('requireApproval without a callback rejects: nobody to ask is not an approval (ADR-0010)', async () => {
        const def: WorkflowDef = {
            name: 'no-approver',
            steps: [makeStep('a', [], true)],
        };
        const { runner } = makeRunner(def);
        const result = await runner.run();
        expect(result.steps['a'].status).toBe('rejected');
    });

    it('emits workflow_start and workflow_complete events', async () => {
        const def: WorkflowDef = { name: 'events-test', steps: [makeStep('x')] };
        const { transport, events } = createMockTransport();
        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async () => ({ content: 'ok' }),
        });
        await runner.run();
        expect(events.some(e => e.type === 'workflow_start')).toBe(true);
        expect(events.some(e => e.type === 'workflow_complete')).toBe(true);
    });

    it('step output is accessible in result', async () => {
        const def: WorkflowDef = { name: 'output', steps: [makeStep('x')] };
        const { runner } = makeRunner(def, { x: 'expected output' });
        const result = await runner.run();
        expect(result.steps['x'].content).toBe('expected output');
    });

    it('a failure skips the whole chain, not just the direct dependent (A→B→C)', async () => {
        const def: WorkflowDef = { name: 'chain', steps: [makeStep('a'), makeStep('b', ['a']), makeStep('c', ['b'])] };
        const { transport } = createMockTransport();
        const ran: string[] = [];
        const runner = new WorkflowRunner(def, {
            transport,
            runAgent: async (agentId) => { ran.push(agentId); if (agentId === 'agent-a') throw new Error('boom'); return { content: 'x' }; },
        });
        const result = await runner.run();
        expect(result.status).toBe('failed');
        expect(result.steps['a'].status).toBe('failed');
        expect(result.steps['b'].status).toBe('skipped');
        expect(result.steps['c'].status).toBe('skipped');
        expect(ran).toEqual(['agent-a']);
    });

    it('a cycle in a raw WorkflowDef is reported as failed, not completed with missing steps', async () => {
        const def: WorkflowDef = { name: 'cycle', steps: [makeStep('a', ['b']), makeStep('b', ['a']), makeStep('ok')] };
        const { runner, executionOrder } = makeRunner(def);
        const result = await runner.run();
        expect(result.status).toBe('failed');
        expect(result.steps['ok'].status).toBe('completed');
        expect(result.steps['a'].status).toBe('failed');
        expect(result.steps['a'].error).toMatch(/Unsatisfiable dependencies/);
        expect(result.steps['b'].status).toBe('failed');
        expect(Object.keys(result.steps).sort()).toEqual(['a', 'b', 'ok']);
        expect(executionOrder).toEqual(['agent-ok']);
    });

    it('a dependency on an unknown step is reported as failed', async () => {
        const def: WorkflowDef = { name: 'ghost', steps: [makeStep('a', ['nope'])] };
        const { runner } = makeRunner(def);
        const result = await runner.run();
        expect(result.status).toBe('failed');
        expect(result.steps['a'].status).toBe('failed');
    });
});

describe('WorkflowRunner — wave concurrency', () => {
    const wide = (n: number): WorkflowDef => ({ name: 'wide', steps: Array.from({ length: n }, (_, i) => makeStep(`s${i}`)) });

    function runnerWithPeak(def: WorkflowDef, maxConcurrency?: number) {
        const { transport } = createMockTransport();
        let running = 0;
        const state = { peak: 0 };
        const runner = new WorkflowRunner(def, {
            transport, maxConcurrency,
            runAgent: async () => {
                running++; state.peak = Math.max(state.peak, running);
                await new Promise(r => setTimeout(r, 10));
                running--;
                return { content: 'x' };
            },
        });
        return { runner, state };
    }

    it('limits parallel steps of a wave to maxConcurrency', async () => {
        const { runner, state } = runnerWithPeak(wide(10), 3);
        const result = await runner.run();
        expect(result.status).toBe('completed');
        expect(Object.keys(result.steps)).toHaveLength(10);
        expect(state.peak).toBe(3);
    });

    it('defaults to 8', async () => {
        const { runner, state } = runnerWithPeak(wide(20));
        await runner.run();
        expect(state.peak).toBe(8);
    });
});
