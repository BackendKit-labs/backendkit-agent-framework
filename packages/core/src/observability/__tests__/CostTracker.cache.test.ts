import { CostTracker } from '../CostTracker';
import { MODEL_PRICING } from '../types';

/** SPEC-0001 §6 (ADR-0004): prompt-cache tokens are priced apart from input tokens. */

describe('CostTracker prompt-cache pricing', () => {
    it('prices cache reads and writes with their own rates (numeric case)', () => {
        const t = new CostTracker({
            inputPricePerMToken: 3, outputPricePerMToken: 15,
            cacheReadPricePerMToken: 0.3, cacheWritePricePerMToken: 3.75,
        });
        // 1M input = 3, 1M output = 15, 2M cache read = 0.6, 1M cache write = 3.75
        const batch = t.onTokens(1_000_000, 1_000_000, undefined, { cacheReadTokens: 2_000_000, cacheWriteTokens: 1_000_000 });
        expect(batch).toBeCloseTo(3 + 15 + 0.6 + 3.75, 6);
        expect(t.getRunCost()).toBeCloseTo(22.35, 6);
        expect(t.getDayCost()).toBeCloseTo(22.35, 6);
        t.destroy();
    });

    it('defaults to 0.1 x input for reads and 1.25 x input for writes', () => {
        const t = new CostTracker({ inputPricePerMToken: 10, outputPricePerMToken: 0 });
        t.onTokens(0, 0, undefined, { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
        expect(t.getRunCost()).toBeCloseTo(1 + 12.5, 6);
        t.destroy();
    });

    it('without usage the cost is unchanged', () => {
        const t = new CostTracker({ inputPricePerMToken: 3, outputPricePerMToken: 15 });
        t.onTokens(1_000_000, 0);
        expect(t.getRunCost()).toBeCloseTo(3, 6);
        t.destroy();
    });

    it('cache tokens count toward the budget', () => {
        const seen: string[] = [];
        const t = new CostTracker({
            inputPricePerMToken: 3, budget: { perRun: 1 },
            onBudgetExceeded: u => seen.push(u.budgetExceeded),
        });
        t.onTokens(0, 0, undefined, { cacheWriteTokens: 1_000_000 }); // 3.75
        expect(seen).toEqual(['perRun']);
        t.destroy();
    });

    it('a cached conversation costs less than the same one without cache', () => {
        const p = MODEL_PRICING['claude-sonnet-4-6'];
        const turns = 5, prefix = 50_000, fresh = 500;
        const plain = new CostTracker(p);
        const cached = new CostTracker(p);
        for (let i = 0; i < turns; i++) {
            plain.onTokens(prefix + fresh, 300);
            // first turn writes the prefix, the following ones read it
            cached.onTokens(fresh, 300, undefined, i === 0 ? { cacheWriteTokens: prefix } : { cacheReadTokens: prefix });
        }
        expect(cached.getRunCost()).toBeLessThan(plain.getRunCost());
        plain.destroy(); cached.destroy();
    });

    it('MODEL_PRICING carries cache prices for the Anthropic entries', () => {
        for (const id of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
            const p = MODEL_PRICING[id];
            expect(p.cacheReadPricePerMToken).toBeCloseTo(p.inputPricePerMToken! * 0.1, 6);
            expect(p.cacheWritePricePerMToken).toBeCloseTo(p.inputPricePerMToken! * 1.25, 6);
        }
    });
});
