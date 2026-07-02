import { ProviderRegistry } from '../ProviderRegistry';
import type { LLMProvider } from '../../types';

const stubProvider: LLMProvider = {
    chat: async () => undefined,
};

describe('ProviderRegistry', () => {
    let reg: ProviderRegistry;
    beforeEach(() => { reg = new ProviderRegistry(); });

    it('register → get returns provider', () => {
        reg.register('openai', stubProvider);
        expect(reg.get('openai')).toBe(stubProvider);
    });

    it('has returns correct boolean', () => {
        reg.register('openai', stubProvider);
        expect(reg.has('openai')).toBe(true);
        expect(reg.has('missing')).toBe(false);
    });

    it('ids returns all registered IDs', () => {
        reg.register('a', stubProvider);
        reg.register('b', stubProvider);
        expect(reg.ids()).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('getAll returns a Record of all registered providers keyed by ID', () => {
        const pA: LLMProvider = { chat: async () => undefined };
        const pB: LLMProvider = { chat: async () => undefined };
        reg.register('a', pA);
        reg.register('b', pB);
        expect(reg.getAll()).toEqual({ a: pA, b: pB });
    });

    it('getAll returns an empty object when nothing is registered', () => {
        expect(reg.getAll()).toEqual({});
    });

    it('resolve returns agent-specific provider when registered', () => {
        const pA: LLMProvider = { chat: async () => undefined };
        const pB: LLMProvider = { chat: async () => undefined };
        reg.register('default', pA);
        reg.register('special', pB);
        expect(reg.resolve('special', 'default')).toBe(pB);
    });

    it('resolve falls back to default when agent provider unregistered', () => {
        reg.register('default', stubProvider);
        expect(reg.resolve('unknown', 'default')).toBe(stubProvider);
    });

    it('resolve throws when both agent and default are unregistered', () => {
        expect(() => reg.resolve('a', 'b')).toThrow();
    });

    it('resolve with undefined agentProviderId uses default', () => {
        reg.register('default', stubProvider);
        expect(reg.resolve(undefined, 'default')).toBe(stubProvider);
    });
});
