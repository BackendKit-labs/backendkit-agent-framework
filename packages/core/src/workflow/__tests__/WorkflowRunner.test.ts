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

    it('requireApproval defaults to auto-approve when no callback given', async () => {
        const def: WorkflowDef = {
            name: 'auto-approve',
            steps: [makeStep('a', [], true)],
        };
        const { runner } = makeRunner(def);
        const result = await runner.run();
        expect(result.steps['a'].status).toBe('completed');
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
});
