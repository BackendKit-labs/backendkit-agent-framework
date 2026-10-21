import type { BudgetUsage, CostTrackerConfig } from './types';

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

    // Lightweight midnight-reset: unref'd so it doesn't keep the process alive
    private readonly timer = setInterval(() => this.rollDay(), 60_000).unref();

    constructor(private readonly config: CostTrackerConfig) {}

    onRunStart(): void {
        this.runInput = 0;
        this.runOutput = 0;
        this.runCost = 0;
        this.firedRun = false;
    }

    /** Called when the engine receives a metrics event. Returns estimated cost for this batch. */
    onTokens(inputTokens: number, outputTokens: number, providedCostUsd?: number): number {
        this.rollDay();
        const batchCost = providedCostUsd ?? this.compute(inputTokens, outputTokens);
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

        return this.compute(inputTokens, outputTokens);
    }

    getRunCost(): number { return this.runCost; }
    getDayCost(): number { return this.dayCost; }

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

    destroy(): void { clearInterval(this.timer); }

    private compute(input: number, output: number): number {
        return input  * ((this.config.inputPricePerMToken  ?? 0) / 1_000_000)
             + output * ((this.config.outputPricePerMToken ?? 0) / 1_000_000);
    }
}

function utcDayStart(): number {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
