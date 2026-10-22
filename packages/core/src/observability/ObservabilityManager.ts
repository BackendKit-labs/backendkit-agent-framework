import type { Transport } from '../transport/Transport';
import type { AgentEvent } from '../types';
import { Tracer } from './Tracer';
import { MetricsCollector } from './MetricsCollector';
import { CostTracker } from './CostTracker';
import type { MetricsSnapshot, ObservabilityConfig } from './types';

interface ActiveSpan {
    spanId: string;
    end(status: 'ok' | 'error'): void;
    setTag(key: string, value: string | number | boolean): void;
}

/**
 * Wraps a Transport to intercept AgentEvents and feed them into tracing,
 * metrics collection, and cost tracking.
 *
 * Attach via createBaseEngine({ observability: config }) — the wrapped
 * transport is passed to AgentEngine transparently.
 */
export class ObservabilityManager {
    private readonly tracer: Tracer | null;
    private readonly metrics: MetricsCollector | null;
    private readonly cost: CostTracker | null;
    private readonly metricsConfig: ObservabilityConfig['metrics'];

    // Per-run state
    private runSpan: ActiveSpan | null = null;
    private runStart = 0;
    private runHadError = false;
    private blockSpans = new Map<string, { span: ActiveSpan; start: number }>();

    constructor(private readonly config: ObservabilityConfig) {
        this.tracer = config.tracing ? new Tracer(config.tracing) : null;
        this.metrics = config.metrics ? new MetricsCollector() : null;
        this.cost = config.costTracker ? new CostTracker(config.costTracker) : null;
        this.metricsConfig = config.metrics;
    }

    /** Returns a new Transport that proxies all events through this manager. */
    wrapTransport(transport: Transport): Transport {
        return {
            emit: (event: AgentEvent) => {
                this.handleEvent(event);
                transport.emit(this.withCost(event));
            },
            onInput: (handler) => transport.onInput(handler),
            close: () => transport.close(),
        };
    }

    /** Returns the current cumulative metrics snapshot. */
    getMetricsSnapshot(): MetricsSnapshot | null {
        return this.metrics?.getSnapshot() ?? null;
    }

    /** USD cost of the most recent run (0 if no pricing config). */
    getRunCost(): number { return this.cost?.getRunCost() ?? 0; }

    /** Cumulative USD cost since UTC midnight (0 if no pricing config). */
    getDayCost(): number { return this.cost?.getDayCost() ?? 0; }

    /** True once the current run's cost reached budget.perRun (false without a budget). */
    isRunOverBudget(): boolean { return this.cost?.isRunOverBudget() ?? false; }

    /** Clean up resources (interval timer in CostTracker). */
    destroy(): void { this.cost?.destroy(); }

    // ── Private ────────────────────────────────────────────────────────────────

    // Cost of the `metrics` event being handled (0 when there are no prices configured).
    private batchCostUsd = 0;

    /**
     * Providers report tokens, not money. When a cost tracker with prices is configured, the
     * `metrics` event that goes on to the transport carries the computed `cost_usd`, so any display
     * can show the cost without recomputing it. A cost the provider already reported is left alone.
     */
    private withCost(event: AgentEvent): AgentEvent {
        if (event.type !== 'metrics' || event.cost_usd !== undefined || this.batchCostUsd <= 0) return event;
        return { ...event, cost_usd: this.batchCostUsd };
    }

    private handleEvent(event: AgentEvent): void {
        this.batchCostUsd = 0;
        switch (event.type) {

            case 'ready':
                this.runStart = Date.now();
                this.runHadError = false;
                this.cost?.onRunStart();
                this.runSpan = this.tracer?.startRootSpan('run') ?? null;
                break;

            case 'done': {
                const durationMs = Date.now() - this.runStart;
                this.metrics?.recordRun(durationMs, this.runHadError);
                this.runSpan?.end(this.runHadError ? 'error' : 'ok');
                this.runSpan = null;
                if (this.metricsConfig?.onSnapshot && this.metrics) {
                    this.metricsConfig.onSnapshot(this.metrics.getSnapshot());
                }
                break;
            }

            case 'block_start': {
                const span = this.tracer?.startSpan('agent_block', this.runSpan?.spanId, {
                    agent_id: event.agent_id,
                    ...(event.agent_name ? { agent_name: event.agent_name } : {}),
                }) ?? null;
                if (span) this.blockSpans.set(event.agent_id, { span, start: Date.now() });
                break;
            }

            case 'block_end': {
                const agentId = event.agent_id ?? '';
                const entry = this.blockSpans.get(agentId);
                if (entry) {
                    entry.span.end(event.status === 'ok' ? 'ok' : 'error');
                    this.metrics?.recordAgentBlock(agentId, Date.now() - entry.start);
                    this.blockSpans.delete(agentId);
                }
                break;
            }

            case 'tool_result':
                this.metrics?.recordToolCall(event.name, event.success);
                break;

            case 'guardrail':
                if (!event.dry_run) {
                    this.metrics?.recordGuardrail(event.name, event.action);
                    this.runSpan?.setTag(`guardrail.${event.name}.${event.action}`, true);
                }
                break;

            case 'error':
                this.runHadError = true;
                this.runSpan?.setTag('error', event.message);
                break;

            case 'metrics': {
                const costUsd = this.cost?.onTokens(
                    event.input_tokens,
                    event.output_tokens,
                    event.cost_usd,
                    { cacheReadTokens: event.cache_read_tokens, cacheWriteTokens: event.cache_write_tokens },
                ) ?? 0;
                this.batchCostUsd = costUsd;
                this.metrics?.recordTokens(event.input_tokens, event.output_tokens, costUsd);
                break;
            }
        }
    }
}
