// ── Spans ─────────────────────────────────────────────────────────────────────

export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
    status: 'ok' | 'error';
    tags: Record<string, string | number | boolean>;
}

export type SpanExporter = (span: Span) => void;

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
    runs: {
        total: number;
        errors: number;
        totalDurationMs: number;
        p50Ms: number | null;
        p95Ms: number | null;
        p99Ms: number | null;
    };
    tokens: {
        totalInput: number;
        totalOutput: number;
        estimatedCostUsd: number;
    };
    tools: Record<string, { calls: number; successes: number; failures: number }>;
    agents: Record<string, { invocations: number; totalDurationMs: number }>;
}

// ── Budget ────────────────────────────────────────────────────────────────────

export interface BudgetUsage {
    runCostUsd: number;
    dayCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    budgetExceeded: 'perRun' | 'perDay';
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface TracingConfig {
    /**
     * 'console' prints each finished span to stdout.
     * 'noop' disables tracing.
     * A function receives every finished span — use to export to Jaeger, Zipkin, etc.
     */
    exporter?: SpanExporter | 'console' | 'noop';
}

export interface MetricsConfig {
    /** Called after each run() completes with the cumulative snapshot. */
    onSnapshot?: (snapshot: MetricsSnapshot) => void;
}

export interface CostTrackerConfig {
    /** USD per million input tokens. */
    inputPricePerMToken?: number;
    /** USD per million output tokens. */
    outputPricePerMToken?: number;
    budget?: {
        /** Call onBudgetExceeded when a single run exceeds this cost (USD). */
        perRun?: number;
        /** Call onBudgetExceeded when cumulative daily cost exceeds this (USD). Resets at UTC midnight. */
        perDay?: number;
    };
    currency?: string;
    onBudgetExceeded?: (usage: BudgetUsage) => void;
}

export interface ObservabilityConfig {
    tracing?: TracingConfig;
    metrics?: MetricsConfig;
    costTracker?: CostTrackerConfig;
}

// ── Pricing presets ───────────────────────────────────────────────────────────

/** Per-model pricing (USD / million tokens, mid-2025). Spread into CostTrackerConfig. */
export const MODEL_PRICING: Record<string, Pick<CostTrackerConfig, 'inputPricePerMToken' | 'outputPricePerMToken'>> = {
    'claude-opus-4-8':   { inputPricePerMToken: 15,   outputPricePerMToken: 75   },
    'claude-sonnet-4-6': { inputPricePerMToken: 3,    outputPricePerMToken: 15   },
    'claude-haiku-4-5':  { inputPricePerMToken: 0.80, outputPricePerMToken: 4    },
    'gpt-4o':            { inputPricePerMToken: 5,    outputPricePerMToken: 15   },
    'gpt-4o-mini':       { inputPricePerMToken: 0.15, outputPricePerMToken: 0.60 },
    'deepseek-chat':     { inputPricePerMToken: 0.27, outputPricePerMToken: 1.10 },
};
