import { DelegationBus } from '../DelegationBus';
import type { AgentProfile } from '../../types';

const profile: AgentProfile = { id: 'a', name: 'A', icon: '🅰', description: '', systemPrompt: '', allowedTools: [], delegatesTo: [] };

function makeBus(maxDepth?: number) {
    const runAgent = jest.fn(async (agentId: string) => ({ agentId, content: 'ok', inputTokens: 0, outputTokens: 0, elapsedMs: 0 }));
    const bus = new DelegationBus({
        maxDepth,
        agents: { get: (id: string) => (id === 'a' ? profile : undefined) } as never,
        transport: { emit: () => undefined } as never,
        runAgent,
    });
    return { bus, runAgent };
}

describe('DelegationBus — max delegation depth', () => {
    it('runs a delegation at the limit', async () => {
        const { bus, runAgent } = makeBus(2);
        const r = await bus.runSingle({ agentId: 'a', question: 'q', depth: 2 });
        expect(r.error).toBeUndefined();
        expect(runAgent).toHaveBeenCalledTimes(1);
    });

    it('refuses one level past the limit without running the agent', async () => {
        const { bus, runAgent } = makeBus(2);
        const r = await bus.runSingle({ agentId: 'a', question: 'q', depth: 3 });
        expect(r.error).toBe('max_depth_exceeded');
        expect(r.content).toMatch(/exceeds the limit of 2/);
        expect(runAgent).not.toHaveBeenCalled();
    });

    it('defaults to 5', async () => {
        const { bus } = makeBus();
        expect((await bus.runSingle({ agentId: 'a', question: 'q', depth: 5 })).error).toBeUndefined();
        expect((await bus.runSingle({ agentId: 'a', question: 'q', depth: 6 })).error).toBe('max_depth_exceeded');
    });
});
