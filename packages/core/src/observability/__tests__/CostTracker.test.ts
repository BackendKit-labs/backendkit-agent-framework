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

    describe('budget fires once per limit (ADR-0002)', () => {
        const track = (cfg: ConstructorParameters<typeof CostTracker>[0]) => {
            const seen: BudgetUsage[] = [];
            return { t: new CostTracker({ ...cfg, onBudgetExceeded: u => seen.push(u) }), seen };
        };

        it('perRun fires once even if more metrics arrive', () => {
            const { t, seen } = track({ ...pricing, budget: { perRun: 1 } });
            t.onTokens(1_000_000, 0);
            t.onTokens(1_000_000, 0);
            t.onTokens(1_000_000, 0);
            expect(seen.map(u => u.budgetExceeded)).toEqual(['perRun']);
            t.destroy();
        });

        it('perRun fires again after onRunStart', () => {
            const { t, seen } = track({ ...pricing, budget: { perRun: 1 } });
            t.onTokens(1_000_000, 0);
            t.onRunStart();
            t.onTokens(1_000_000, 0);
            expect(seen).toHaveLength(2);
            t.destroy();
        });

        it('reports perRun and perDay when both are exceeded at once', () => {
            const { t, seen } = track({ ...pricing, budget: { perRun: 1, perDay: 1 } });
            t.onTokens(1_000_000, 0);
            expect(seen.map(u => u.budgetExceeded)).toEqual(['perRun', 'perDay']);
            t.destroy();
        });

        it('perDay fires once per day and again after the day rolls over', () => {
            jest.useFakeTimers({ now: Date.UTC(2026, 9, 21, 12) });
            const { t, seen } = track({ ...pricing, budget: { perDay: 1 } });
            t.onTokens(1_000_000, 0);
            t.onTokens(1_000_000, 0);
            expect(seen).toHaveLength(1);
            jest.setSystemTime(Date.UTC(2026, 9, 22, 1));
            t.onTokens(1_000_000, 0);
            expect(seen).toHaveLength(2);
            expect(t.getDayCost()).toBeCloseTo(3, 5);
            t.destroy();
        });

        it('provided cost accumulates across calls and drives getRunCost / isRunOverBudget', () => {
            const { t, seen } = track({ budget: { perRun: 0.5 } });
            t.onTokens(10, 10, 0.3);
            expect(t.isRunOverBudget()).toBe(false);
            t.onTokens(10, 10, 0.3);
            expect(t.getRunCost()).toBeCloseTo(0.6, 5);
            expect(t.isRunOverBudget()).toBe(true);
            expect(seen).toHaveLength(1);
            t.destroy();
        });
    });
});

describe('CostTracker lifecycle and the cost it reports (audit D-08, D-10)', () => {
    it('holds no timer: creating trackers leaves no interval behind', () => {
        const spy = jest.spyOn(global, 'setInterval');
        const t = new CostTracker({ inputPricePerMToken: 1, outputPricePerMToken: 1 });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        t.destroy();
    });

    it('returns the cost the provider gave, not the estimate, as the totals count it', () => {
        const t = new CostTracker({ inputPricePerMToken: 1_000_000, outputPricePerMToken: 0 });
        expect(t.onTokens(1, 0, 0.5)).toBe(0.5);
        expect(t.getRunCost()).toBe(0.5);
        expect(t.onTokens(1, 0)).toBe(1);
    });

    it('rolls the day over when read, without a timer', () => {
        jest.useFakeTimers({ now: Date.UTC(2026, 0, 1, 23, 59) });
        try {
            const t = new CostTracker({ inputPricePerMToken: 1_000_000 });
            t.onTokens(1, 0);
            expect(t.getDayCost()).toBe(1);
            jest.setSystemTime(Date.UTC(2026, 0, 2, 0, 1));
            expect(t.getDayCost()).toBe(0);
        } finally { jest.useRealTimers(); }
    });
});