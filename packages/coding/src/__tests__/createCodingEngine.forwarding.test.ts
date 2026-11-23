import * as core from '@backendkit-labs/agent-core';

/**
 * createCodingEngine forwards options to createBaseEngine with conditional spreads, which
 * TypeScript does not check for excess properties (the P0 bug of SPEC-0001 §2 dropped
 * onToolApproval that way). Guard the wiring of the options added by ADR-0001 and ADR-0002.
 */
jest.mock('@backendkit-labs/agent-core', () => ({
    ...jest.requireActual('@backendkit-labs/agent-core'),
    createBaseEngine: jest.fn(() => ({})),
}));
// The first-run seed would write to the real home directory.
jest.mock('../config/ConfigLoader', () => ({
    ConfigLoader: class { configPath = 'test'; load() { return { defaultProvider: 'ollama', providers: { ollama: { apiKey: 'k' } } }; } },
}));
jest.mock('../cli/bootstrap/GlobalSeed', () => ({ runGlobalSeed: jest.fn(async () => undefined) }));

import { createCodingEngine, createCodingEngineFromConfig, localIdentityDefaults } from '../index';

describe('createCodingEngine option forwarding', () => {
    it('forwards the agent identity, who it acts for and the opt-out (SPEC-0044), which TypeScript would not catch if dropped', () => {
        const agentIdentity = { resolve: () => ({ id: 'did:ex:coder' }) };
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true, agentIdentity, identity: { userId: 'carlos' }, requireAgentIdentity: false });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call.agentIdentity).toBe(agentIdentity);
        expect(call.identity).toEqual({ userId: 'carlos' });
        expect(call.requireAgentIdentity).toBe(false);
    });

    it('createCodingEngine adds no identity by itself: you say who the agent is and whom it acts for', () => {
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call.agentIdentity).toBeUndefined();
        expect(call.identity).toBeUndefined();
    });

    it('createCodingEngineFromConfig gives the zero-config identity, and anything passed overrides it', () => {
        createCodingEngineFromConfig({ disablePersistence: true });
        const defaults = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(defaults.agentIdentity).toBeDefined();
        expect(typeof defaults.identity.userId).toBe('string');
        createCodingEngineFromConfig({ disablePersistence: true, identity: { userId: 'ana' } });
        expect((core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0].identity).toEqual({ userId: 'ana' });
    });

    it('the zero-config defaults are self-asserted and act for the person running it, BK_AGENT_USER first', () => {
        const before = process.env.BK_AGENT_USER;
        try {
            process.env.BK_AGENT_USER = 'carlos';
            const d = localIdentityDefaults();
            expect(d.identity).toEqual({ userId: 'carlos' });
            expect(d.agentIdentity.resolve('coder', { sessionId: 's' })).toMatchObject({ assurance: 'self-asserted' });
            delete process.env.BK_AGENT_USER;
            expect(typeof localIdentityDefaults().identity.userId).toBe('string');
            expect(localIdentityDefaults().identity.userId).not.toBe('');
        } finally {
            if (before === undefined) delete process.env.BK_AGENT_USER; else process.env.BK_AGENT_USER = before;
        }
    });

    it('forwards maxParallelTools, observability and abortOnBudget to createBaseEngine', () => {
        const observability = { costTracker: { inputPricePerMToken: 3, budget: { perRun: 1 } } };
        createCodingEngine({
            providers: { ollama: {} } as never,
            defaultProvider: 'ollama',
            disablePersistence: true,
            maxParallelTools: 3,
            observability,
            abortOnBudget: true,
        });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call.maxParallelTools).toBe(3);
        expect(call.observability).toBe(observability);
        expect(call.abortOnBudget).toBe(true);
    });

    it('extraTools are added after the coding tools, which stay; without them the tools are the coding tools', () => {
        const extra = { name: 'deploy_preview', description: 'x', parameters: { type: 'object' }, readOnly: true, execute: async () => 'ok' };
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true });
        const base = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0].tools as Array<{ name: string }>;
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true, extraTools: [extra as never] });
        const withExtra = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0].tools as Array<{ name: string }>;
        expect(withExtra.map(t => t.name)).toEqual([...base.map(t => t.name), 'deploy_preview']);
        expect(base.map(t => t.name)).not.toContain('deploy_preview');
    });

    it('forwards the Anthropic cache and thinking options to the provider (ADR-0004)', () => {
        createCodingEngine({
            providers: { anthropic: { apiKey: 'k', maxTokens: 4000, cache: 'auto', cacheTtl: '1h', thinking: { budgetTokens: 2000 } } } as never,
            defaultProvider: 'anthropic',
            disablePersistence: true,
        });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        const provider = call.providers.anthropic as Record<string, unknown>;
        expect(provider.cache).toBe('auto');
        expect(provider.cacheTtl).toBe('1h');
        expect(provider.thinking).toEqual({ budgetTokens: 2000 });
    });

    it('picks the structured-output mode per provider (ADR-0003)', () => {
        const caps = (providers: unknown, defaultProvider: string) => {
            createCodingEngine({ providers: providers as never, defaultProvider, disablePersistence: true });
            const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
            return (call.providers[defaultProvider] as { capabilities: { structuredOutput: string } }).capabilities.structuredOutput;
        };
        // DeepSeek has no json_schema: it must not inherit the generic provider's 'native'.
        expect(caps({ deepseek: { apiKey: 'k' } }, 'deepseek')).toBe('json_object');
        expect(caps({ openai: { apiKey: 'k' } }, 'openai')).toBe('native');
        expect(caps({ deepseek: { apiKey: 'k', structuredOutput: 'native' } }, 'deepseek')).toBe('native');
        expect(caps({ ollama: {} }, 'ollama')).toBe('json_object');
        expect(caps({ ollama: { structuredOutput: 'native' } }, 'ollama')).toBe('native');
        expect(caps({ anthropic: { apiKey: 'k' } }, 'anthropic')).toBe('native');
    });

    it('lets the deepseek provider drop thinking on forced tool choices, and only that one', () => {
        const flag = (providers: unknown, id: string) => {
            createCodingEngine({ providers: providers as never, defaultProvider: id, disablePersistence: true });
            const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
            return (call.providers[id] as { disableThinkingForForcedTools: boolean }).disableThinkingForForcedTools;
        };
        expect(flag({ deepseek: { apiKey: 'k' } }, 'deepseek')).toBe(true);
        expect(flag({ openai: { apiKey: 'k' } }, 'openai')).toBe(false);
    });

    it('fails fast on an invalid thinking budget', () => {
        expect(() => createCodingEngine({
            providers: { anthropic: { apiKey: 'k', thinking: { budgetTokens: 10 } } } as never,
            defaultProvider: 'anthropic',
            disablePersistence: true,
        })).toThrow(/budgetTokens/);
    });

    it('omits them when not set', () => {
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call).not.toHaveProperty('abortOnBudget');
        expect(call).not.toHaveProperty('observability');
        expect(call).not.toHaveProperty('maxParallelTools');
    });
});
