/** `engine.getTools()`: the registry of the engine, to wrap or replace a tool without forking the framework. */
import { createBaseEngine } from '../createBaseEngine';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, id: 'a', allowedTools: ['read'], delegatesTo: [] };
const read = (out: string): ToolDefinition => ({ name: 'read', description: 'reads', parameters: { type: 'object' }, readOnly: true, execute: async () => out });

function build(script: Turn[]) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [agent], defaultAgent: agent.id,
        tools: [read('original')], transport, workingDir: process.cwd(), iterationMode: 'auto',
    });
    return { engine, events };
}

const callRead: Turn = { tool_calls: [{ id: 'c1', name: 'read', args: {} }] };

describe('engine.getTools()', () => {
    it('is the registry the engine runs its tools from: it lists what was registered', () => {
        const { engine } = build([]);
        expect(engine.getTools().getAll().map(t => t.name)).toEqual(['read']);
        expect(engine.getTools().get('read')?.description).toBe('reads');
    });

    it('unregister and register replace a definition, and the next run uses the new one (a guard added without forking)', async () => {
        const { engine, events } = build([callRead, { content: 'a' }, callRead, { content: 'b' }]);
        await engine.run('1');
        engine.getTools().unregister('read');
        engine.getTools().register(read('guarded'));
        await engine.run('2');
        const previews = events.filter(e => e.type === 'tool_result').map(e => (e as { preview?: string }).preview);
        expect(previews).toEqual(['original', 'guarded']);
    });
});
