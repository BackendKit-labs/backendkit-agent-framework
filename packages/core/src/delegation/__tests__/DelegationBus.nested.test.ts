import { DelegationBus } from '../DelegationBus';
import type { AgentProfile } from '../../types';

const profile = (id: string): AgentProfile => ({ id, name: id, icon: '·', description: '', systemPrompt: '', allowedTools: [], delegatesTo: [] });
const registry = { get: (id: string) => profile(id) } as never;
const transport = { emit: () => undefined } as never;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('DelegationBus — nested delegations are bounded per depth', () => {
    it('no more than maxParallel nested delegations run at once at the same depth', async () => {
        let running = 0;
        let peak = 0;
        const bus = new DelegationBus({
            maxParallel: 2, agents: registry, transport,
            runAgent: async (agentId) => {
                running++; peak = Math.max(peak, running);
                await sleep(20);
                running--;
                return { agentId, content: 'ok', inputTokens: 0, outputTokens: 0, elapsedMs: 0 };
            },
        });
        await Promise.all(Array.from({ length: 8 }, () => bus.runSingle({ agentId: 'a', question: 'q', depth: 1 })));
        expect(peak).toBe(2);
    });

    it('a chain whose every level is saturated by parents still finishes (no deadlock)', async () => {
        // maxParallel 1: depth 0 holds its slot while it waits for depth 1, which holds its slot while it waits for depth 2.
        const bus: DelegationBus = new DelegationBus({
            maxParallel: 1, agents: registry, transport,
            runAgent: async (agentId, _q, _c, depth = 0) => {
                if (depth < 2) await bus.runSingle({ agentId, question: 'q', depth: depth + 1 });
                return { agentId, content: `done@${depth}`, inputTokens: 0, outputTokens: 0, elapsedMs: 0 };
            },
        });
        const result = await Promise.race([
            bus.runSingle({ agentId: 'a', question: 'q', depth: 0 }),
            sleep(2_000).then(() => 'deadlock' as const),
        ]);
        expect(result).not.toBe('deadlock');
        expect((result as { content: string }).content).toBe('done@0');
    });
});
