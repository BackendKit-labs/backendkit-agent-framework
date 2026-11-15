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
    /**
     * Delegation chain of the agent that asks, oldest first (SPEC-0014 principal). The delegate's chain is this
     * plus its own id. When absent, `[fromAgentId]` is assumed.
     */
    chain?: string[];
}

export interface DelegationResult {
    agentId: string;
    content: string;
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
    error?: string;
}

/** Default cap on nested delegation: top-level is 0, so agent A → B → C → D is depth 3. */
export const DEFAULT_MAX_DELEGATION_DEPTH = 5;

export interface DelegationBusOptions {
    maxParallel?: number;
    /** Deepest nesting allowed for a delegation; deeper requests fail with `max_depth_exceeded`. Default 5. */
    maxDepth?: number;
    agents: AgentRegistry;
    transport: Transport;
    runAgent(
        agentId: string,
        question: string,
        context?: string,
        depth?: number,
        outputBuffer?: AgentEvent[],
        /** Chain of the delegate itself: the caller's chain plus the delegate's id. */
        chain?: string[],
    ): Promise<DelegationResult>;
}

export class DelegationBus {
    /**
     * One bulkhead per nesting depth. A single shared one would deadlock (parents holding every slot while
     * waiting for children that need one); with one per depth a delegation only ever waits on the pool of its
     * own level, and a chain only descends, so no cycle is possible. Total concurrency is bounded by
     * maxParallel × (maxDepth + 1).
     */
    private readonly bulkheads = new Map<number, Bulkhead>();

    constructor(private readonly opts: DelegationBusOptions) {
        this.bulkheadFor(0);
    }

    private bulkheadFor(depth: number): Bulkhead {
        let bulkhead = this.bulkheads.get(depth);
        if (!bulkhead) {
            bulkhead = new Bulkhead({
                name: depth === 0 ? 'delegation-bus' : `delegation-bus-depth-${depth}`,
                maxConcurrentCalls: this.opts.maxParallel ?? 6,
                maxQueueSize: 50,
                queueTimeoutMs: 120_000, // 2 min — agent calls can be long
                rejectWhenFull: false,
            });
            this.bulkheads.set(depth, bulkhead);
        }
        return bulkhead;
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
        const maxDepth = this.opts.maxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
        if (depth > maxDepth) {
            return {
                agentId: request.agentId,
                content: `Error: delegation depth ${depth} exceeds the limit of ${maxDepth}; answer without delegating further`,
                inputTokens: 0,
                outputTokens: 0,
                elapsedMs: 0,
                error: 'max_depth_exceeded',
            };
        }

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
            const callerChain = request.chain ?? (request.fromAgentId ? [request.fromAgentId] : []);
            return this.opts.runAgent(request.agentId, request.question, request.context, depth, outputBuffer, [...callerChain, request.agentId]);
        };

        try {
            return await this.bulkheadFor(depth).execute(execute);
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
        return this.bulkheadFor(0).getMetrics();
    }
}
