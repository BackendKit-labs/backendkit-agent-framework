import type { AgentProfile } from '../types';
export declare class AgentRegistry {
    private agents;
    register(profile: AgentProfile): this;
    registerAll(profiles: AgentProfile[]): this;
    get(id: string): AgentProfile | undefined;
    getAll(): AgentProfile[];
    has(id: string): boolean;
}
//# sourceMappingURL=AgentRegistry.d.ts.map