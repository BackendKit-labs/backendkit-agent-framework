import type { LLMProvider } from '../types';

export class ProviderRegistry {
    private readonly providers = new Map<string, LLMProvider>();

    register(id: string, provider: LLMProvider): this {
        this.providers.set(id, provider);
        return this;
    }

    get(id: string): LLMProvider | undefined {
        return this.providers.get(id);
    }

    resolve(agentProviderId: string | undefined, defaultId: string): LLMProvider {
        const id = agentProviderId ?? defaultId;
        const provider = this.providers.get(id) ?? this.providers.get(defaultId);
        if (!provider) throw new Error(`Provider "${id}" not registered. Available: ${[...this.providers.keys()].join(', ')}`);
        return provider;
    }

    has(id: string): boolean {
        return this.providers.has(id);
    }

    ids(): string[] {
        return [...this.providers.keys()];
    }

    /**
     * All registered providers keyed by ID. Providers don't carry their own ID
     * (unlike AgentProfile/ToolDefinition), so this returns a Record rather than
     * an array — matches the shape createBaseEngine's `providers` option expects.
     */
    getAll(): Record<string, LLMProvider> {
        return Object.fromEntries(this.providers);
    }
}
