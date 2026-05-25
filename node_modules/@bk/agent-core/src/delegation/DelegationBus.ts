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

export class DelegationBus {
    private readonly maxParallel: number;

    constructor(private readonly opts: DelegationBusOptions) {
        this.maxParallel = opts.maxParallel ?? 6;
    }

    async runParallel(requests: DelegationRequest[]): Promise<DelegationResult[]> {
        const results: DelegationResult[] = [];

        // Process in waves of maxParallel
        for (let i = 0; i < requests.length; i += this.maxParallel) {
            const wave = requests.slice(i, i + this.maxParallel);
            const waveResults = await Promise.all(
                wave.map(req => this.runSingle(req))
            );
            results.push(...waveResults);
        }

        return results;
    }

    async runSingle(request: DelegationRequest): Promise<DelegationResult> {
        const profile = this.opts.agents.get(request.agentId);
        if (!profile) {
            return {
                agentId: request.agentId,
                content: `Agent "${request.agentId}" not found in registry`,
                inputTokens: 0,
                outputTokens: 0,
                elapsedMs: 0,
                error: 'agent_not_found',
            };
        }

        this.opts.transport.emit({
            type: 'agent_switch',
            from: 'orchestrator',
            to: profile.id,
            to_name: profile.name,
            to_icon: profile.icon,
        });

        try {
            return await this.opts.runAgent(request.agentId, request.question, request.context);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                agentId: request.agentId,
                content: `Error: ${message}`,
                inputTokens: 0,
                outputTokens: 0,
                elapsedMs: 0,
                error: message,
            };
        }
    }
}
