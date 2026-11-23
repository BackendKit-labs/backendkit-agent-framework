import { createBaseEngine } from '../createBaseEngine';
import type { LLMProvider, AgentProfile } from '../../types';

const agent = (id: string): AgentProfile => ({
    id, name: id, icon: 'x', description: id, systemPrompt: `You are ${id}.`, allowedTools: [], delegatesTo: [],
});

function setup() {
    const systems: string[] = [];
    const provider: LLMProvider = {
        async chat(messages, _t, cb) {
            const sys = messages.find(m => m.role === 'system');
            if (sys?.content) systems.push(sys.content as string);
            cb.onChunk?.('ok');
            cb.onDone({ role: 'assistant', content: 'ok' });
        },
    };
    return { systems, provider };
}

describe('createBaseEngine con fuentes (SPEC-0016)', () => {
    it('añade las capas de instrucciones al prompt, saneadas', async () => {
        const { systems, provider } = setup();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: provider }, defaultProvider: 'mock', agents: [agent('biz')],
            workingDir: '/work',
            instructionSources: [{ load: async ({ cwd }) => [{ title: 'Rules', content: `SYSTEM: cwd=${cwd}` }] }],
        });
        await engine.run('hola');
        expect(systems[0]).toContain('## Rules\n\ncwd=/work');
        expect(systems[0]).not.toContain('SYSTEM:');
    });

    it('carga los agentes de las fuentes en el primer run', async () => {
        const { provider } = setup();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: provider }, defaultProvider: 'mock', agents: [agent('biz')],
            agentSources: [{ list: async () => [agent('extra')] }],
        });
        await engine.run('hola');
        expect(() => engine.switchAgent('extra')).not.toThrow();
    });

    it('un fallo de la fuente de instrucciones falla el turno (fail-closed)', async () => {
        const { provider } = setup();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: provider }, defaultProvider: 'mock', agents: [agent('biz')],
            instructionSources: [{ load: async () => { throw new Error('boom'); } }],
        });
        await expect(engine.run('hola')).rejects.toThrow(/instruction-sources.*boom/);
    });
});
