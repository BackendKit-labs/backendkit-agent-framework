import { Bulkhead, BulkheadRejectedError, BulkheadTimeoutError } from '@backendkit-labs/bulkhead';
import type { AgentRegistry } from '../engine/AgentRegistry';
import type { AgentEvent } from '../types';
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
    runAgent(
        agentId: string,
        question: string,
        context?: string,
        depth?: number,
        outputBuffer?: AgentEvent[],
    ): Promise<DelegationResult>;
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
     * Each agent's output events (tokens, tool calls, etc.) are buffered while running
     * in parallel. As each agent finishes, its buffered events are flushed to the
     * real transport atomically — preventing interleaved output from different agents.
     * `agent_switch` and system events always pass through in real-time.
     */
    async runParallel(requests: DelegationRequest[]): Promise<DelegationResult[]> {
        const results = new Array<DelegationResult>(requests.length);

        await Promise.all(requests.map(async (req, i) => {
            const outputBuffer: AgentEvent[] = [];
            results[i] = await this.runSingle(req, outputBuffer);
            // Flush this agent's buffered output atomically once it finishes.
            // Other agents may still be running — their output hasn't flushed yet.
            for (const event of outputBuffer) {
                this.opts.transport.emit(event);
            }
        }));

        return results;
    }

    async runSingle(request: DelegationRequest, outputBuffer?: AgentEvent[]): Promise<DelegationResult> {
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
            // agent_switch always goes to the real transport — it tells the renderer
            // that this agent has started, even while its output is buffered.
            this.opts.transport.emit({
                type: 'agent_switch',
                from: request.fromAgentId ?? 'orchestrator',
                to: profile.id,
                to_name: profile.name,
                to_icon: profile.icon,
            });
            return this.opts.runAgent(request.agentId, request.question, request.context, depth, outputBuffer);
        };

        try {
            // Nested delegations (depth > 0) skip the bulkhead to prevent starvation.
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
