/** The arithmetic the advisor is about, against the rules of the design (§6, §8.3, §8.5). No framework here. */
import { PRICES, SimulatedBroker, SIGNALS, fuse, planRebalance, recommend } from '../domain';

describe('signal fusion (design §8)', () => {
    it('sources that agree lean to their side; the weights are renormalised over the sources present (§8.3)', () => {
        const bearish = fuse(SIGNALS.AAA!);
        expect(bearish.action).toBe('BEARISH');
        expect(bearish.score).toBeCloseTo((0.35 * -0.6 + 0.30 * -0.8 + 0.10 * -0.4) / 0.75, 6);
        expect(fuse(SIGNALS.BBB!).action).toBe('BULLISH');
    });
    it('sources that contradict with alike weights hold (§8.5), and one side with more than 1.5× the other wins', () => {
        const conflict = fuse(SIGNALS.CCC!);
        expect(conflict.action).toBe('CONFLICT_HOLD');
        expect(conflict.bullishWeight).toBeGreaterThan(0);
        expect(conflict.bearishWeight).toBeGreaterThan(0);
        expect(fuse({ news: 0.9, smartMoney13F: 0.5, technical: -0.2 }).action).toBe('BULLISH');   // 0.30+0.35 against 0.10: more than 1.5×
    });
    it('with one source only, that source decides; with none, nothing', () => {
        expect(fuse({ news: -0.5 })).toMatchObject({ action: 'BEARISH', score: -0.5 });
        expect(fuse({})).toMatchObject({ action: 'NEUTRAL', score: 0 });
    });
});

describe('the decision matrix (design §6)', () => {
    const f = (score: number) => ({ score, action: score > 0 ? 'BULLISH' as const : 'BEARISH' as const, bullishWeight: 0, bearishWeight: 0 });
    it('below -0.7 exit whatever the share; below -0.5 reduce only a share above 10%; above 0.5 increase only a share below 5%', () => {
        expect(recommend(f(-0.8), 0.02)).toBe('CONSIDER_EXIT');
        expect(recommend(f(-0.6), 0.2)).toBe('CONSIDER_REDUCE');
        expect(recommend(f(-0.6), 0.05)).toBe('HOLD');
        expect(recommend(f(0.6), 0.02)).toBe('CONSIDER_INCREASE');
        expect(recommend(f(0.6), 0.3)).toBe('HOLD');
    });
    it('a conflict never recommends a move', () => {
        expect(recommend({ score: -0.9, action: 'CONFLICT_HOLD', bullishWeight: 0.5, bearishWeight: 0.5 }, 0.5)).toBe('HOLD');
    });
});

describe('the simulated broker and the rebalance', () => {
    const broker = () => new SimulatedBroker({ cash: 10_000, holdings: { AAA: 60, BBB: 20 } });   // 10000 + 6000 + 1000 = 17000

    it('values the portfolio at market prices', () => {
        const b = broker();
        expect(b.value()).toBe(10_000 + 60 * PRICES.AAA! + 20 * PRICES.BBB!);
        expect(b.allocation().AAA).toBeCloseTo(6_000 / 17_000, 8);
    });
    it('the orders bring each holding to its target, sells first', () => {
        const b = broker();
        const orders = planRebalance(b, { AAA: 0.2, BBB: 0.4, CCC: 0.2 });
        expect(orders[0]).toMatchObject({ symbol: 'AAA', side: 'sell' });
        for (const o of orders) b.place(o);
        expect(b.allocation().AAA!).toBeCloseTo(0.2, 1);
        expect(b.allocation().BBB!).toBeCloseTo(0.4, 1);
    });
    it('refuses what cannot be: no cash, no shares, a wrong amount, another currency, an unknown symbol', () => {
        const b = broker();
        expect(() => b.place({ symbol: 'AAA', side: 'buy', quantity: 1000, amount: 100_000, currency: 'EUR' })).toThrow(/not enough cash/);
        expect(() => b.place({ symbol: 'AAA', side: 'sell', quantity: 100, amount: 10_000, currency: 'EUR' })).toThrow(/not enough shares/);
        expect(() => b.place({ symbol: 'AAA', side: 'buy', quantity: 1, amount: 5, currency: 'EUR' })).toThrow(/not quantity × price/);
        expect(() => b.place({ symbol: 'AAA', side: 'buy', quantity: 1, amount: 100, currency: 'USD' })).toThrow(/only EUR/);
        expect(() => b.place({ symbol: 'ZZZ', side: 'buy', quantity: 1, amount: 1, currency: 'EUR' })).toThrow(/unknown symbol/);
        expect(b.executed).toHaveLength(0);
    });
});
