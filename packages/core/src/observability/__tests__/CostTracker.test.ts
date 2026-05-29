import { CostTracker } from '../CostTracker';
import type { BudgetUsage } from '../types';

const pricing = { inputPricePerMToken: 3, outputPricePerMToken: 15 };

describe('CostTracker', () => {
    afterEach(() => jest.useRealTimers());

    it('getRunCost / getDayCost start at 0', () => {
        const tracker = new CostTracker(pricing);
        expect(tracker.getRunCost()).toBe(0);
        expect(tracker.getDayCost()).toBe(0);
        tracker.destroy();
    });

    it('onTokens accumulates and returns batch cost', () => {
        const tracker = new CostTracker(pricing);
        // 1M input tokens = $3, 1M output = $15
        const cost = tracker.onTokens(1_000_000, 0);
        expect(cost).toBeCloseTo(3, 5);
        expect(tracker.getRunCost()).toBeCloseTo(3, 5);
        tracker.destroy();
    });

    it('onRunStart resets per-run counters', () => {
        const tracker = new CostTracker(pricing);
        tracker.onTokens(1_000_000, 0);
        tracker.onRunStart();
        expect(tracker.getRunCost()).toBe(0);
        tracker.destroy();
    });

    it('getDayCost persists across run resets', () => {
        const tracker = new CostTracker(pricing);
        tracker.onTokens(1_000_000, 0);   // $3
        tracker.onRunStart();
        tracker.onTokens(0, 1_000_000);   // $15
        expect(tracker.getDayCost()).toBeCloseTo(18, 5);
        tracker.destroy();
    });

    it('fires onBudgetExceeded for perRun', () => {
        const usage: BudgetUsage[] = [];
        const tracker = new CostTracker({
            ...pricing,
            budget: { perRun: 0.01 },   // $0.01 limit
            onBudgetExceeded: (u) => usage.push(u),
        });
        tracker.onTokens(10_000, 0);    // 10k tokens × $3/M = $0.03 → exceeds
        expect(usage).toHaveLength(1);
        expect(usage[0].budgetExceeded).toBe('perRun');
        tracker.destroy();
    });

    it('fires onBudgetExceeded for perDay', () => {
        const usage: BudgetUsage[] = [];
        const tracker = new CostTracker({
            ...pricing,
            budget: { perDay: 0.001 },
            onBudgetExceeded: (u) => usage.push(u),
        });
        tracker.onTokens(1_000, 0);     // $0.003 → exceeds $0.001 daily limit
        expect(usage.some(u => u.budgetExceeded === 'perDay')).toBe(true);
        tracker.destroy();
    });

    it('uses providedCostUsd for budget threshold, not as return value', () => {
        const exceeded: BudgetUsage[] = [];
        const tracker = new CostTracker({
            ...pricing,
            budget: { perRun: 1 },          // $1 limit
            onBudgetExceeded: (u) => exceeded.push(u),
        });
        // 0 computed tokens, but tell it we spent $42 → should exceed $1 budget
        tracker.onTokens(0, 0, 42);
        expect(exceeded).toHaveLength(1);
        expect(exceeded[0].budgetExceeded).toBe('perRun');
        tracker.destroy();
    });

    it('no pricing config → zero cost', () => {
        const tracker = new CostTracker({});
        tracker.onTokens(1_000_000, 1_000_000);
        expect(tracker.getRunCost()).toBe(0);
        tracker.destroy();
    });
});
