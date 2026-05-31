import type { AgentProfile } from '../types';

export class AgentRegistry {
    private agents = new Map<string, AgentProfile>();

    register(profile: AgentProfile): this {
        if (this.agents.has(profile.id)) {
            throw new Error(`Agent "${profile.id}" already registered`);
        }
        this.agents.set(profile.id, profile);
        return this;
    }

    /** Register or replace an existing agent (used by AgentLoader for global/project overrides) */
    upsert(profile: AgentProfile): this {
        this.agents.set(profile.id, profile);
        return this;
    }

    registerAll(profiles: AgentProfile[]): this {
        for (const p of profiles) this.register(p);
        return this;
    }

    get(id: string): AgentProfile | undefined {
        return this.agents.get(id);
    }

    getAll(): AgentProfile[] {
        return Array.from(this.agents.values());
    }

    has(id: string): boolean {
        return this.agents.has(id);
    }

    delete(id: string): boolean {
        return this.agents.delete(id);
    }
}
