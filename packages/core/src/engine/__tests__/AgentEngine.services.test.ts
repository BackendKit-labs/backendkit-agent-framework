import { createBaseEngine } from '../createBaseEngine';
import { getService } from '../../tools/services';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';
import type { ToolDefinition } from '../../types';

function run(services: Parameters<typeof createBaseEngine>[0]['services']) {
    const seen: Array<{ agent: string; value: unknown }> = [];
    const tool: ToolDefinition = {
        name: 'probe', description: 'probe', parameters: { type: 'object' }, readOnly: true,
        execute: async (_a, ctx) => { seen.push({ agent: ctx.agentId, value: getService(ctx, 'vertical.value') }); return 'ok'; },
    };
    const { transport } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c1', name: 'probe', args: {} }] }, { content: 'done' }]) },
        defaultProvider: 'mock', agents: [{ ...testAgent, allowedTools: ['probe'] }], defaultAgent: testAgent.id,
        tools: [tool], transport, workingDir: process.cwd(), iterationMode: 'auto', services,
    });
    return { engine, seen };
}

describe('ExecutionContext.services (SPEC-0015 F4)', () => {
    it('a tool reads what the vertical passed as a record', async () => {
        const { engine, seen } = run({ 'vertical.value': 42 });
        await engine.run('go');
        expect(seen).toEqual([{ agent: testAgent.id, value: 42 }]);
    });

    it('a function receives the agent the call runs for', async () => {
        const { engine, seen } = run((profile) => ({ 'vertical.value': `for-${profile?.id}` }));
        await engine.run('go');
        expect(seen[0].value).toBe(`for-${testAgent.id}`);
    });

    it('without services getService returns undefined', async () => {
        const { engine, seen } = run(undefined);
        await engine.run('go');
        expect(seen[0].value).toBeUndefined();
    });
});
