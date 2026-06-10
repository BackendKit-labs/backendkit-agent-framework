import { Bulkhead, BulkheadRejectedError, BulkheadTimeoutError } from '@backendkit-labs/bulkhead';
import type { AgentRegistry } from '../engine/AgentRegistry';
import type { Transport } from '../transport/Transport';

export interface DelegationRequest {
    agentId: string;
    question: string;
    context?: string;
    relevantFiles?: string[];
    /** ID of the agent that initiated this delegation. Used for agent_switch events. */
    fromAgentId?: string;
    /**
     * Nesting depth of this delegation (0 = top-level from run(), 1+ = called from a tool).
     * Nested calls skip the bulkhead semaphore to prevent starvation when all top-level
     * slots are occupied by agents that are themselves waiting for nested delegations.
     */
    depth?: number;
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
    transport: Transport;
    runAgent(agentId: string, question: string, context?: string, depth?: number): Promise<DelegationResult>;
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

        const { depth = 0 } = request;

        const execute = () => {
            // Emit agent_switch only when execution actually starts (not while queued).
            this.opts.transport.emit({
                type: 'agent_switch',
                from: request.fromAgentId ?? 'orchestrator',
                to: profile.id,
                to_name: profile.name,
                to_icon: profile.icon,
            });
            return this.opts.runAgent(request.agentId, request.question, request.context, depth);
        };

        try {
            // Nested delegations (depth > 0) skip the bulkhead to prevent starvation:
            // if all top-level slots are occupied by agents waiting for nested calls,
            // those nested calls would deadlock waiting for a slot to free up.
            return depth > 0
                ? await execute()
                : await this.bulkhead.execute(execute);
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
