/**
 * The DOMAIN of the advisor: a simulated market, a simulated broker and the three pieces of arithmetic the design asks for. Nothing here uses the
 * framework: it is what an agent is ABOUT, so that the rest of the example (identity, mandates, approval, delegation, audit) has something real to
 * govern. The numbers and rules come from the design of the finance portfolio system (`design.md`): the decision matrix of §6, the default
 * weights of §8.3 and the conflict rules of §8.5. Nothing is invented here, and nothing is advice: it is a simulation.
 */

export const CURRENCY = 'EUR';

// ── The simulated market ───────────────────────────────────────────────────────────────────────────────────────

export const PRICES: Readonly<Record<string, number>> = { AAA: 100, BBB: 50, CCC: 20 };

/** What each source says about a symbol, from -1 (bearish) to +1 (bullish). Fixed, so the example is deterministic. */
export interface Signals { news?: number; smartMoney13F?: number; technical?: number }
export const SIGNALS: Readonly<Record<string, Signals>> = {
    AAA: { news: -0.8, smartMoney13F: -0.6, technical: -0.4 },
    BBB: { news: 0.7, smartMoney13F: 0.6, technical: 0.5 },
    CCC: { news: 0.6, smartMoney13F: -0.7, technical: 0.1 },       // sources that contradict each other
};

// ── The simulated broker ───────────────────────────────────────────────────────────────────────────────────────

export interface Order { symbol: string; side: 'buy' | 'sell'; quantity: number; amount: number; currency: string }

export class SimulatedBroker {
    readonly executed: Order[] = [];
    private readonly holdings = new Map<string, number>();
    cash: number;

    constructor(initial: { cash: number; holdings: Record<string, number> }) {
        this.cash = initial.cash;
        for (const [symbol, quantity] of Object.entries(initial.holdings)) this.holdings.set(symbol, quantity);
    }

    quantityOf(symbol: string): number { return this.holdings.get(symbol) ?? 0; }

    /** Total value of cash and holdings at the market prices. */
    value(): number {
        let total = this.cash;
        for (const [symbol, quantity] of this.holdings) total += quantity * (PRICES[symbol] ?? 0);
        return total;
    }

    allocation(): Record<string, number> {
        const total = this.value();
        const out: Record<string, number> = {};
        for (const [symbol, quantity] of this.holdings) out[symbol] = (quantity * (PRICES[symbol] ?? 0)) / total;
        return out;
    }

    place(order: Order): void {
        if (order.currency !== CURRENCY) throw new Error(`only ${CURRENCY} is supported`);
        const price = PRICES[order.symbol];
        if (price === undefined) throw new Error(`unknown symbol "${order.symbol}"`);
        if (order.quantity <= 0 || !Number.isFinite(order.quantity)) throw new Error('the quantity must be a positive number');
        const cost = order.quantity * price;
        if (Math.abs(cost - order.amount) > 0.01) throw new Error(`the amount ${order.amount} is not quantity × price (${cost})`);
        if (order.side === 'buy') {
            if (cost > this.cash) throw new Error('not enough cash');
            this.cash -= cost;
            this.holdings.set(order.symbol, this.quantityOf(order.symbol) + order.quantity);
        } else {
            if (order.quantity > this.quantityOf(order.symbol)) throw new Error('not enough shares to sell');
            this.cash += cost;
            this.holdings.set(order.symbol, this.quantityOf(order.symbol) - order.quantity);
        }
        this.executed.push(order);
    }
}

// ── Rebalancing: deviation from the target, as orders ──────────────────────────────────────────────────────────

/** The target allocation, as a fraction of the total value. The rest is cash. */
export type Targets = Readonly<Record<string, number>>;

/** Orders that bring each holding back to its target (whole shares, rounded to the nearest). Sells first, so the cash is there for the buys. */
export function planRebalance(broker: SimulatedBroker, targets: Targets): Order[] {
    const total = broker.value();
    const orders: Order[] = [];
    for (const [symbol, target] of Object.entries(targets)) {
        const price = PRICES[symbol];
        if (price === undefined) continue;
        const wanted = Math.round((target * total) / price);
        const delta = wanted - broker.quantityOf(symbol);
        if (delta === 0) continue;
        orders.push({ symbol, side: delta > 0 ? 'buy' : 'sell', quantity: Math.abs(delta), amount: Math.abs(delta) * price, currency: CURRENCY });
    }
    return orders.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1));
}

// ── Signal fusion (design §8) ─────────────────────────────────────────────────────────────────────────────────

/** §8.3 default weights, for the three sources this example has. They are renormalised over the sources a symbol actually has. */
export const DEFAULT_WEIGHTS = { smartMoney13F: 0.35, news: 0.30, technical: 0.10 } as const;

export type FusedAction = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'CONFLICT_HOLD';
export interface Fused { score: number; action: FusedAction; bullishWeight: number; bearishWeight: number }

/**
 * §8.5: weigh each side (bullish, bearish) by the weight of the sources on it. If one side has more than 1.5× the other, lean to it. If the sides
 * are alike and they contradict, `CONFLICT_HOLD`. (The co-investment cluster rule of §8.5 needs the 13F detail this example does not have.)
 */
export function fuse(signals: Signals): Fused {
    const present = (Object.keys(DEFAULT_WEIGHTS) as Array<keyof typeof DEFAULT_WEIGHTS>).filter(k => typeof signals[k] === 'number');
    const total = present.reduce((sum, k) => sum + DEFAULT_WEIGHTS[k], 0);
    if (present.length === 0 || total === 0) return { score: 0, action: 'NEUTRAL', bullishWeight: 0, bearishWeight: 0 };
    let score = 0, bullishWeight = 0, bearishWeight = 0;
    for (const k of present) {
        const w = DEFAULT_WEIGHTS[k] / total, v = signals[k] as number;
        score += w * v;
        if (v > 0) bullishWeight += w; else if (v < 0) bearishWeight += w;
    }
    const contradict = bullishWeight > 0 && bearishWeight > 0;
    let action: FusedAction = 'NEUTRAL';
    if (bullishWeight > 1.5 * bearishWeight) action = 'BULLISH';
    else if (bearishWeight > 1.5 * bullishWeight) action = 'BEARISH';
    else if (contradict) action = 'CONFLICT_HOLD';
    return { score, action, bullishWeight, bearishWeight };
}

// ── Recommendation (design §6 decision matrix) ─────────────────────────────────────────────────────────────

export type Recommendation = 'CONSIDER_INCREASE' | 'CONSIDER_REDUCE' | 'CONSIDER_EXIT' | 'HOLD';

/**
 * §6, the rows that need no trend (the two that need "improving" or "declining" are left out: this example has no history). A conflict never
 * recommends a move: `CONFLICT_HOLD` holds.
 */
export function recommend(fused: Fused, allocation: number): Recommendation {
    if (fused.action === 'CONFLICT_HOLD') return 'HOLD';
    if (fused.score < -0.7) return 'CONSIDER_EXIT';
    if (fused.score < -0.5 && allocation > 0.10) return 'CONSIDER_REDUCE';
    if (fused.score > 0.5 && allocation < 0.05) return 'CONSIDER_INCREASE';
    return 'HOLD';
}
