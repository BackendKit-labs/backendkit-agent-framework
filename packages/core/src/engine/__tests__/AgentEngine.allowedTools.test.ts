import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

function tool(name: string, executed: string[]): ToolDefinition {
    return {
        name, description: name, parameters: { type: 'object', properties: {} },
        execute: async () => { executed.push(name); return 'ran'; },
    };
}

function run(
    agent: Partial<AgentProfile>,
    calls: string[],
    extra: Partial<BaseEngineOptions> = {},
    otherAgents: AgentProfile[] = [],
) {
    const executed: string[] = [];
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider([
            { tool_calls: calls.map((name, i) => ({ id: `c${i}`, name, args: {} })) },
            { content: 'done' },
        ]) },
        defaultProvider: 'mock',
        agents: [{ ...testAgent, ...agent }, ...otherAgents],
        defaultAgent: testAgent.id,
        tools: ['read_file', 'write_file', 'run_command'].map(n => tool(n, executed)),
        transport,
        workingDir: process.cwd(),
       
        ...extra,
    });
    const results = () => events.filter((e): e is Extract<typeof e, { type: 'tool_result' }> => e.type === 'tool_result');
    return { engine, executed, results };
}

describe('AgentEngine — an agent can call only the tools it lists', () => {
    it('allowedTools: [] means no tools: a call by name does not run (it used to run any registered tool)', async () => {
        const { engine, executed, results } = run({ allowedTools: [], delegatesTo: [] }, ['run_command']);
        await engine.run('go');
        expect(executed).toEqual([]);
        expect(results()[0]).toMatchObject({ name: 'run_command', success: false });
    });

    it('the refusal says how to fix it', async () => {
        const { engine, results } = run({ allowedTools: [], delegatesTo: [] }, ['write_file']);
        await engine.run('go');
        expect(results()[0].preview).toContain('not authorized');
        expect(results()[0].preview).toContain('allowedTools');
    });

    it('a listed tool runs, an unlisted one does not, in the same turn', async () => {
        const { engine, executed, results } = run({ allowedTools: ['read_file'] }, ['read_file', 'write_file']);
        await engine.run('go');
        expect(executed).toEqual(['read_file']);
        expect(results().map(r => [r.name, r.success])).toEqual([['read_file', true], ['write_file', false]]);
    });

    it('an agent that delegates and has no tools is still told to use ask_agent (unchanged)', async () => {
        const specialist: AgentProfile = { ...testAgent, id: 'spec', name: 'Spec', allowedTools: [], delegatesTo: [] };
        const { engine, executed, results } = run({ allowedTools: [], delegatesTo: ['spec'] }, ['write_file'], {}, [specialist]);
        await engine.run('go');
        expect(executed).toEqual([]);
        expect(results()[0].preview).toContain('ask_agent');
    });
});

describe('AgentEngine — allowUnlistedTools keeps the old behavior for profiles not fixed yet', () => {
    it('lets an agent with no allowedTools and no delegatesTo call a registered tool', async () => {
        const { engine, executed } = run({ allowedTools: [], delegatesTo: [] }, ['read_file'], { allowUnlistedTools: true });
        await engine.run('go');
        expect(executed).toEqual(['read_file']);
    });

    it('does not widen anything else: a non-empty allowedTools is still enforced, and so is an empty one with delegation', async () => {
        const listed = run({ allowedTools: ['read_file'] }, ['write_file'], { allowUnlistedTools: true });
        await listed.engine.run('go');
        expect(listed.executed).toEqual([]);

        const specialist: AgentProfile = { ...testAgent, id: 'spec', name: 'Spec', allowedTools: [], delegatesTo: [] };
        const delegating = run({ allowedTools: [], delegatesTo: ['spec'] }, ['write_file'], { allowUnlistedTools: true }, [specialist]);
        await delegating.engine.run('go');
        expect(delegating.executed).toEqual([]);
    });
});
