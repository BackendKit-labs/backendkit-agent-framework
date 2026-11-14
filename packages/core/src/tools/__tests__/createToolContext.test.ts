import { createToolContext, createInMemorySessionMemory } from '../createToolContext';

describe('createToolContext', () => {
    it('fills in defaults for everything a tool may touch', async () => {
        const ctx = createToolContext();
        expect(ctx.agentId).toBe('direct');
        expect(ctx.sessionId).toBe('direct');
        expect(ctx.memory.getAll()).toEqual({});
        await expect(ctx.askAgent('planner', 'q')).rejects.toThrow(/not available outside an AgentEngine/);
        expect(ctx.signal).toBeUndefined();
    });

    it('keeps what the caller passes', () => {
        const controller = new AbortController();
        const ctx = createToolContext({
            agentId: 'p2p',
            sessionId: 's1',
            workingDir: '/work',
            signal: controller.signal,
            secrets: { ERP_TOKEN: 'x' },
        });
        expect(ctx).toMatchObject({ agentId: 'p2p', sessionId: 's1', workingDir: '/work', secrets: { ERP_TOKEN: 'x' } });
        expect(ctx.signal).toBe(controller.signal);
    });

    it('memory round-trips within the context', () => {
        const memory = createInMemorySessionMemory();
        memory.set('k', 'v');
        expect(memory.get('k')).toBe('v');
        expect(memory.get('missing')).toBeUndefined();
        expect(memory.getAll()).toEqual({ k: 'v' });
    });
});
