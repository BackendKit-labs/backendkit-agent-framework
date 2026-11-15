import { codingPipelineHooks } from '../coding-pipeline-hooks';
import type { RunContext } from '../../governance/hooks';
import type { AgentProfile } from '../../types';

function ctx(hasQa = true): RunContext {
    return {
        principal: { agentId: 'general', sessionId: 's', chain: ['general'] },
        input: 'implement the endpoint',
        state: new Map(),
        signal: new AbortController().signal,
        hasAgent: (id) => hasQa && id === 'qa-engineer',
        emit: jest.fn(),
    };
}

const profile = (id: string) => ({ id } as AgentProfile);

const result = () => ({
    task: { status: 'implementation', domains: ['api'], actionType: 'implementation', riskLevel: 'high',
        requiresQaApproval: true, requiresArchitectureReview: false, requiresSecurityReview: false, rawPrompt: 'implement the endpoint' },
    selectedAgents: [{ agentId: 'backend', score: 90, reason: 'owns api' }],
    appliedPolicies: [], requiredGates: ['qa'], commitAllowed: false,
});

function orchestratorWith(r: unknown) {
    return {
        orchestrate: jest.fn().mockResolvedValue(r),
        transitionTask: jest.fn((task: { status: string }, status: string) => ({ allowed: true, task: { ...task, status } })),
        getAuditReporter: () => ({ recordGate: jest.fn().mockResolvedValue(undefined), completeSprint: jest.fn().mockResolvedValue(undefined) }),
    } as never;
}

const code = Array.from({ length: 10 }, (_, i) => `const v${i} = ${i};`).join('\n');
const qaService = { countCodeLines: () => 10, extractFindings: () => [], evaluateReview: () => true, reviewResponse: async () => 'ok' } as never;

describe('codingPipelineHooks', () => {
    it('beforeRun stores the classification and the default agent gets the brief', async () => {
        const hooks = codingPipelineHooks({ orchestrator: orchestratorWith(result()), defaultAgentId: 'general' });
        const c = ctx();
        await hooks.beforeRun!(c);
        expect(await hooks.systemPrompt!(c, profile('general'))).toContain('Orchestrator Analysis');
        expect(await hooks.systemPrompt!(c, profile('backend'))).toBeUndefined();
    });

    it('beforeRun fails closed by default and warns in open mode', async () => {
        const failing = { orchestrate: async () => { throw new Error('down'); } } as never;
        await expect(codingPipelineHooks({ orchestrator: failing }).beforeRun!(ctx())).rejects.toThrow(/refusing to run without its gates: down/);
        const c = ctx();
        await codingPipelineHooks({ orchestrator: failing, failureMode: 'open' }).beforeRun!(c);
        expect(c.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
        expect(c.state.size).toBe(0);
    });

    it('afterTurn asks for a pass of qa-engineer once the task is in qa_review', async () => {
        const hooks = codingPipelineHooks({ orchestrator: orchestratorWith(result()), qaService });
        const c = ctx();
        await hooks.beforeRun!(c);
        const next = await hooks.afterTurn!(c, { text: code, profile: profile('general') });
        expect(next).toEqual({ action: 'continue', agentId: 'qa-engineer', message: expect.stringContaining('Review the following') });
    });

    it('afterTurn without a qa-engineer reviews inline and does not continue', async () => {
        const hooks = codingPipelineHooks({ orchestrator: orchestratorWith(result()), qaService });
        const c = ctx(false);
        await hooks.beforeRun!(c);
        await expect(hooks.afterTurn!(c, { text: code, profile: profile('general') })).resolves.toBeUndefined();
    });

    it('afterTurn does nothing without a classification', async () => {
        const hooks = codingPipelineHooks({ orchestrator: orchestratorWith(result()), qaService });
        await expect(hooks.afterTurn!(ctx(), { text: code, profile: profile('general') })).resolves.toBeUndefined();
    });
});
