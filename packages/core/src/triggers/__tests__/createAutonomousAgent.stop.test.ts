import { createAutonomousAgent } from '../createAutonomousAgent';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

function agentWith(extra: Record<string, unknown> = {}) {
    return createAutonomousAgent({
        providers: { mock: createScriptedProvider([{ content: 'ok' }]) },
        defaultProvider: 'mock',
        agents: [testAgent],
        defaultAgent: testAgent.id,
        transport: createMockTransport().transport,
        workingDir: process.cwd(),
        triggers: [],
        ...extra,
    });
}

describe('createAutonomousAgent — stop()', () => {
    it('disconnects the MCP servers it started, not only the triggers', async () => {
        const agent = agentWith({ mcpServers: [{ name: 'src', command: 'node', args: ['-e', ''] }] });
        const manager = agent.engine.getMCPManager();
        expect(manager).toBeDefined();
        const disconnect = jest.spyOn(manager!, 'disconnect').mockResolvedValue(undefined);

        await agent.stop();

        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('stops an agent with no MCP servers without failing', async () => {
        const agent = agentWith();
        expect(agent.engine.getMCPManager()).toBeUndefined();
        await expect(agent.stop()).resolves.toBeUndefined();
    });
});
