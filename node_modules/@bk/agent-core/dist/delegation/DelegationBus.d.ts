import type { AgentRegistry } from '../engine/AgentRegistry';
import type { ToolRegistry } from '../engine/ToolRegistry';
import type { LLMProvider, LLMMessage } from '../types';
import type { Transport } from '../transport/Transport';
export interface DelegationRequest {
    agentId: string;
    question: string;
    context?: string;
    relevantFiles?: string[];
}
export interface DelegationResult {
    agentId: string;
    content: string;
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
    error?: string;
}
export interface DelegationBusOptions {
    maxParallel?: number;
    agents: AgentRegistry;
    tools: ToolRegistry;
    provider: LLMProvider;
    transport: Transport;
    parentMessages: LLMMessage[];
    workingDir?: string;
    runAgent(agentId: string, question: string, context?: string): Promise<DelegationResult>;
}
export declare class DelegationBus {
    private readonly opts;
    private readonly maxParallel;
    constructor(opts: DelegationBusOptions);
    runParallel(requests: DelegationRequest[]): Promise<DelegationResult[]>;
    runSingle(request: DelegationRequest): Promise<DelegationResult>;
}
//# sourceMappingURL=DelegationBus.d.ts.map