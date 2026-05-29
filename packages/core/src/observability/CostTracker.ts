import type { BudgetUsage, CostTrackerConfig } from './types';

export class CostTracker {
    private runInput = 0;
    private runOutput = 0;
    private dayInput = 0;
    private dayOutput = 0;
    private dayStartMs = utcDayStart();

    // Lightweight midnight-reset: unref'd so it doesn't keep the process alive
    private readonly timer = setInterval(() => {
        const now = utcDayStart();
        if (now !== this.dayStartMs) {
            this.dayInput = 0;
            this.dayOutput = 0;
            this.dayStartMs = now;
        }
    }, 60_000).unref();

    constructor(private readonly config: CostTrackerConfig) {}

    onRunStart(): void {
        this.runInput = 0;
        this.runOutput = 0;
    }

    /** Called when the engine receives a metrics event. Returns estimated cost for this batch. */
    onTokens(inputTokens: number, outputTokens: number, providedCostUsd?: number): number {
        this.runInput += inputTokens;
        this.runOutput += outputTokens;
        this.dayInput += inputTokens;
        this.dayOutput += outputTokens;

        const runCost = providedCostUsd ?? this.compute(this.runInput, this.runOutput);
        const dayCost = this.compute(this.dayInput, this.dayOutput);

        if (this.config.budget?.perRun !== undefined && runCost >= this.config.budget.perRun) {
            this.config.onBudgetExceeded?.({
                runCostUsd: runCost, dayCostUsd: dayCost,
                inputTokens: this.runInput, outputTokens: this.runOutput,
                budgetExceeded: 'perRun',
            });
        } else if (this.config.budget?.perDay !== undefined && dayCost >= this.config.budget.perDay) {
            this.config.onBudgetExceeded?.({
                runCostUsd: runCost, dayCostUsd: dayCost,
                inputTokens: this.dayInput, outputTokens: this.dayOutput,
                budgetExceeded: 'perDay',
            });
        }

        return this.compute(inputTokens, outputTokens);
    }

    getRunCost(): number { return this.compute(this.runInput, this.runOutput); }
    getDayCost(): number { return this.compute(this.dayInput, this.dayOutput); }

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
