import type { BudgetUsage, CostTrackerConfig } from './types';

/** Prompt-cache tokens of one metrics event; they are not part of `inputTokens`. */
export interface CacheUsage { cacheReadTokens?: number; cacheWriteTokens?: number }

// Anthropic multipliers over the input price, used when no explicit cache price is configured.
const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

export class CostTracker {
    private runInput = 0;
    private runOutput = 0;
    private runCost = 0;
    private dayInput = 0;
    private dayOutput = 0;
    private dayCost = 0;
    private dayStartMs = utcDayStart();
    // onBudgetExceeded fires once per limit: perRun per run, perDay per UTC day.
    private firedRun = false;
    private firedDay = false;

    // The day rolls over when the tracker is used (recording or reading), not on a timer: an interval kept every tracker,
    // and what it holds, alive for good, one per engine, and engines are not disposed (audit D-08).

    constructor(private readonly config: CostTrackerConfig) {}

    onRunStart(): void {
        this.runInput = 0;
        this.runOutput = 0;
        this.runCost = 0;
        this.firedRun = false;
    }

    /**
     * Called when the engine receives a metrics event. Returns estimated cost for this batch.
     * `usage` carries prompt-cache tokens, which providers report apart from `inputTokens`.
     */
    onTokens(inputTokens: number, outputTokens: number, providedCostUsd?: number, usage?: CacheUsage): number {
        this.rollDay();
        const batchCost = providedCostUsd ?? this.compute(inputTokens, outputTokens, usage);
        this.runInput += inputTokens;
        this.runOutput += outputTokens;
        this.runCost += batchCost;
        this.dayInput += inputTokens;
        this.dayOutput += outputTokens;
        this.dayCost += batchCost;

        const budget = this.config.budget;
        if (!this.firedRun && budget?.perRun !== undefined && this.runCost >= budget.perRun) {
            this.firedRun = true;
            this.config.onBudgetExceeded?.({
                runCostUsd: this.runCost, dayCostUsd: this.dayCost,
                inputTokens: this.runInput, outputTokens: this.runOutput,
                budgetExceeded: 'perRun',
            });
        }
        if (!this.firedDay && budget?.perDay !== undefined && this.dayCost >= budget.perDay) {
            this.firedDay = true;
            this.config.onBudgetExceeded?.({
                runCostUsd: this.runCost, dayCostUsd: this.dayCost,
                inputTokens: this.dayInput, outputTokens: this.dayOutput,
                budgetExceeded: 'perDay',
            });
        }

        // What was added to the totals: the provider's own cost when it gave one, not the estimate (audit D-10).
        return batchCost;
    }

    getRunCost(): number { return this.runCost; }
    getDayCost(): number { this.rollDay(); return this.dayCost; }

    /** True once the current run's cost reached budget.perRun. */
    isRunOverBudget(): boolean {
        const perRun = this.config.budget?.perRun;
        return perRun !== undefined && this.runCost >= perRun;
    }

    private rollDay(): void {
        const now = utcDayStart();
        if (now !== this.dayStartMs) {
            this.dayInput = 0;
            this.dayOutput = 0;
            this.dayCost = 0;
            this.firedDay = false;
            this.dayStartMs = now;
        }
    }

    /** Kept for compatibility: there is no timer to stop any more. */
    destroy(): void { /* nothing to release */ }

    private compute(input: number, output: number, usage?: CacheUsage): number {
        const inPrice = this.config.inputPricePerMToken ?? 0;
        const readPrice = this.config.cacheReadPricePerMToken ?? inPrice * CACHE_READ_FACTOR;
        const writePrice = this.config.cacheWritePricePerMToken ?? inPrice * CACHE_WRITE_FACTOR;
        return (input  * inPrice
              + output * (this.config.outputPricePerMToken ?? 0)
              + (usage?.cacheReadTokens ?? 0)  * readPrice
              + (usage?.cacheWriteTokens ?? 0) * writePrice) / 1_000_000;
    }
}

function utcDayStart(): number {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
