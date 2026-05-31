import { Bulkhead, BulkheadRejectedError, BulkheadTimeoutError } from '@backendkit-labs/bulkhead';
import type { AgentRegistry } from '../engine/AgentRegistry';
import type { ToolRegistry } from '../engine/ToolRegistry';
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
    transport: Transport;
    workingDir?: string;
    runAgent(agentId: string, question: string, context?: string): Promise<DelegationResult>;
}

export class DelegationBus {
    private readonly bulkhead: Bulkhead;

    constructor(private readonly opts: DelegationBusOptions) {
        this.bulkhead = new Bulkhead({
            name: 'delegation-bus',
            maxConcurrentCalls: opts.maxParallel ?? 6,
            maxQueueSize: 50,
            queueTimeoutMs: 120_000, // 2 min — agent calls can be long
            rejectWhenFull: false,
        });
    }

    /**
     * Runs all requests concurrently, bounded by the bulkhead semaphore.
     *
     * Unlike the previous wave-based approach, slots free up immediately as
     * individual agents finish — no waiting for the whole wave to complete.
     */
    async runParallel(requests: DelegationRequest[]): Promise<DelegationResult[]> {
        return Promise.all(requests.map(req => this.runSingle(req)));
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
            return await this.bulkhead.execute(
                () => this.opts.runAgent(request.agentId, request.question, request.context),
            );
        } catch (err) {
            const message =
                err instanceof BulkheadRejectedError ? 'Delegation rejected: queue is full' :
                err instanceof BulkheadTimeoutError  ? 'Delegation timed out in queue' :
                err instanceof Error ? err.message : String(err);
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

    getBulkheadMetrics() {
        return this.bulkhead.getMetrics();
    }
}
