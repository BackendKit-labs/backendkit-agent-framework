import { planFlow, UNRESOLVED_AGENT } from '../planner';
import type { StructuredChat } from '../planner';
import { runFlow } from '../run';
import type { LLMMessage } from '../../types';

const agents = [
    { id: 'conta', name: 'Contabilidad', capabilities: ['asientos'], domain: 'finance', gate: true, gateCriteria: ['cuadra el balance'] },
    { id: 'audit', name: 'Auditoría', capabilities: ['revisión'] },
];

/** A chat that answers with the given texts in order, and records what it was asked. */
function scripted(...answers: unknown[]) {
    const asked: LLMMessage[][] = [];
    const chat: StructuredChat = async (messages) => {
        asked.push(messages);
        const a = answers[Math.min(asked.length - 1, answers.length - 1)];
        return typeof a === 'string' ? a : JSON.stringify(a);
    };
    return { chat, asked };
}

const goodPlan = {
    summary: 'Cerrar el mes',
    subtasks: [
        { id: 't1', agent_id: 'conta', task: 'Cuadrar el mes', depends_on: [] },
        { id: 't2', agent_id: 'audit', task: 'Revisar', depends_on: ['t1'] },
    ],
};

describe('planFlow', () => {
    it('turns the model plan into a runnable FlowDefinition', async () => {
        const { chat, asked } = scripted(goodPlan);
        const planned = await planFlow('Cerrar el mes de octubre', { agents, chat });
        expect(planned.summary).toBe('Cerrar el mes');
        expect(planned.unresolved).toEqual([]);
        expect(planned.flow.steps.map(s => [s.id, s.agent, s.after])).toEqual([['t1', 'conta', []], ['t2', 'audit', ['t1']]]);
        expect(JSON.stringify(asked[0])).toContain('Cerrar el mes de octubre');
        expect(JSON.stringify(asked[0])).toContain('id: audit');

        const ran: string[] = [];
        const r = await runFlow(planned.flow, { executor: { run: async (s) => { ran.push(s.id); return { content: '' }; } }, approvals: undefined });
        expect(ran).toEqual(['t1', 't2']);
        expect(r.status).toBe('completed');
    });

    it('an agent configured as gated gets its gate and criteria whatever the model said', async () => {
        const { chat } = scripted(goodPlan);
        const { flow } = await planFlow('x', { agents, chat });
        expect(flow.steps[0].gate).toMatchObject({ approval: 'human', criteria: ['cuadra el balance'] });
        expect(flow.steps[1].gate).toBeUndefined();
    });

    it('the gate the model sets is kept, with its criteria added to the agent\'s', async () => {
        const plan = { summary: 's', subtasks: [{ id: 't1', agent_id: 'audit', task: 'a', depends_on: [], gate: true, gate_criteria: ['sin duplicados'] }] };
        const { flow } = await planFlow('x', { agents, chat: scripted(plan).chat });
        expect(flow.steps[0].gate).toMatchObject({ approval: 'human', criteria: ['sin duplicados'] });
    });

    it('an invalid plan is sent back with what was wrong, and the corrected one is used', async () => {
        const bad = { summary: 's', subtasks: [{ id: 't1', agent_id: 'invented', task: 'a', depends_on: [] }] };
        const { chat, asked } = scripted(bad, goodPlan);
        const { flow } = await planFlow('x', { agents, chat });
        expect(asked).toHaveLength(2);
        expect(JSON.stringify(asked[1])).toContain('unknown agent_id: invented');
        expect(flow.steps).toHaveLength(2);
    });

    it.each([
        ['an unknown dependency', { summary: 's', subtasks: [{ id: 't1', agent_id: 'audit', task: 'a', depends_on: ['zz'] }] }, /unknown id: zz/],
        ['a duplicate id', { summary: 's', subtasks: [{ id: 't1', agent_id: 'audit', task: 'a' }, { id: 't1', agent_id: 'audit', task: 'b' }] }, /duplicate sub-task id/],
        ['a cycle', { summary: 's', subtasks: [{ id: 'a', agent_id: 'audit', task: 'a', depends_on: ['b'] }, { id: 'b', agent_id: 'audit', task: 'b', depends_on: ['a'] }] }, /cycle: a -> b -> a/],
    ])('rejects %s once the retries are spent', async (_name, plan, message) => {
        await expect(planFlow('x', { agents, chat: scripted(plan).chat, retries: 0 })).rejects.toThrow(message);
    });

    it('a capability no agent covers stays in the flow and is reported', async () => {
        const plan = { summary: 's', subtasks: [
            { id: 't1', agent_id: UNRESOLVED_AGENT, task: 'Firmar con certificado', depends_on: [] },
            { id: 't2', agent_id: 'audit', task: 'Revisar', depends_on: ['t1'] },
        ] };
        const planned = await planFlow('x', { agents, chat: scripted(plan).chat });
        expect(planned.unresolved).toEqual(['t1']);
        expect(planned.flow.steps).toHaveLength(2);
    });

    it('takes the model from a provider too, and passes knowledge and policy text to it', async () => {
        const seen: string[] = [];
        const provider = {
            id: 'fake', capabilities: {},
            chat: async (messages: LLMMessage[], _t: unknown, cb: { onChunk: (s: string) => void; onDone: (m: { content: string }) => void }) => {
                seen.push(JSON.stringify(messages));
                cb.onChunk(JSON.stringify(goodPlan));
                cb.onDone({ content: JSON.stringify(goodPlan) });
            },
        };
        const planned = await planFlow('x', {
            agents, provider: provider as never, context: 'El cierre exige conciliación', policyContext: 'MANDATORY GATES: finance',
        });
        expect(planned.flow.steps).toHaveLength(2);
        expect(seen[0]).toContain('El cierre exige conciliación');
        expect(seen[0]).toContain('MANDATORY GATES: finance');
    });

    it('needs a model and at least one agent', async () => {
        await expect(planFlow('x', { agents })).rejects.toThrow(/provider or a chat/);
        await expect(planFlow('x', { agents: [], chat: scripted(goodPlan).chat })).rejects.toThrow(/at least one agent/);
    });
});
