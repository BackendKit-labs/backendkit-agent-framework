import type { EngineOptions, LLMProvider } from '../types';
import type { Transport } from '../transport/Transport';
import type { AgentRegistry } from './AgentRegistry';
import type { ToolRegistry } from './ToolRegistry';
export interface AgentEngineOptions extends EngineOptions {
    agents: AgentRegistry;
    tools: ToolRegistry;
    provider: LLMProvider;
    transport: Transport;
    defaultAgentId: string;
}
export declare class AgentEngine {
    private readonly opts;
    private readonly memory;
    private readonly bus;
    private currentAgentId;
    private messages;
    private aborted;
    constructor(opts: AgentEngineOptions);
    run(input: string): Promise<void>;
    abort(): void;
    switchAgent(agentId: string): void;
    private getCurrentProfile;
    private buildSystemPrompt;
    private getToolsForAgent;
    private runLoop;
    private runAgentInternal;
    private buildContext;
}
//# sourceMappingURL=AgentEngine.d.ts.map