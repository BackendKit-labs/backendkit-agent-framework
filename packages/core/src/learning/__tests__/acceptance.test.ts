/**
 * SPEC-0017 F6, criterio de cierre: un agente de negocio, sin codigo de coding, aprende de una tool que falla
 * de forma repetida: recibe la leccion en su prompt y se genera una regla propuesta que espera aprobacion.
 */
import { createBaseEngine } from '../../engine/createBaseEngine';
import { createLearning } from '..';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, id: 'ap', name: 'Accounts payable', allowedTools: ['post_invoice'], delegatesTo: [] };

const failingTool: ToolDefinition = {
    name: 'post_invoice', description: 'posts an invoice', parameters: { type: 'object' },
    execute: async () => { throw new Error('ERP rejected the posting'); },
};

const call = (id: string): Turn => ({ tool_calls: [{ id, name: 'post_invoice', args: { n: id } }] });

describe('un agente de negocio aprende de una tool que falla', () => {
    it('recibe la leccion en su prompt y deja una regla pendiente de aprobacion', async () => {
        const learning = createLearning({ threshold: 3 });
        const { transport } = createMockTransport();

        const systems: string[] = [];
        const scripted = createScriptedProvider([
            call('1'), call('2'), call('3'), { content: 'done' },       // run 1: three failures
            { content: 'next run' },                                    // run 2
        ]);
        const provider: LLMProvider = {
            async chat(messages, tools, cb, ...rest) {
                const sys = messages.find(m => m.role === 'system');
                if (sys?.content) systems.push(sys.content as string);
                return scripted.chat(messages, tools, cb, ...rest);
            },
        } as LLMProvider;

        const engine = createBaseEngine({
            providers: { mock: provider }, defaultProvider: 'mock',
            agents: [agent], defaultAgent: agent.id, tools: [failingTool],
            transport, workingDir: process.cwd(), iterationMode: 'auto',
            learning,
        });

        await engine.run('post the invoices');
        await engine.run('post another one');

        // The second run's prompt carries the lesson.
        const last = systems[systems.length - 1];
        expect(last).toContain('Lessons learned');
        expect(last).toContain('post_invoice');

        // A rule is proposed, and nothing was applied on its own.
        const pending = await learning.proposals();
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('pending');
        expect(pending[0].subject.kind).toBe('rule_proposal');
        expect(await learning.rules.list()).toEqual([]);
    });
});
