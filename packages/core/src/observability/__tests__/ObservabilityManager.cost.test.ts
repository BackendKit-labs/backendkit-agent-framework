import { ObservabilityManager } from '../ObservabilityManager';
import { createMockTransport } from '../../__tests__/helpers';

/** The metrics event that reaches the transport carries the computed cost, so UIs can show it. */

describe('ObservabilityManager: cost_usd on metrics events', () => {
    const prices = { inputPricePerMToken: 3, outputPricePerMToken: 15 };

    function setup(config: ConstructorParameters<typeof ObservabilityManager>[0]) {
        const { transport: inner, events } = createMockTransport();
        const manager = new ObservabilityManager(config);
        return { wrapped: manager.wrapTransport(inner), events, manager };
    }

    it('adds the computed cost when prices are configured', () => {
        const { wrapped, events, manager } = setup({ costTracker: prices });
        wrapped.emit({ type: 'metrics', input_tokens: 1_000_000, output_tokens: 100_000 });
        expect(events[0]).toEqual({ type: 'metrics', input_tokens: 1_000_000, output_tokens: 100_000, cost_usd: 4.5 });
        manager.destroy();
    });

    it('includes prompt-cache tokens in the cost', () => {
        const { wrapped, events, manager } = setup({ costTracker: { ...prices, cacheReadPricePerMToken: 0.3 } });
        wrapped.emit({ type: 'metrics', input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000 });
        expect((events[0] as { cost_usd?: number }).cost_usd).toBeCloseTo(0.3, 6);
        manager.destroy();
    });

    it('leaves the event untouched without a cost tracker or without prices', () => {
        for (const config of [{}, { costTracker: {} }, { costTracker: { budget: { perRun: 1 } } }]) {
            const { wrapped, events, manager } = setup(config);
            wrapped.emit({ type: 'metrics', input_tokens: 10, output_tokens: 5 });
            expect(events[0]).toEqual({ type: 'metrics', input_tokens: 10, output_tokens: 5 });
            manager.destroy();
        }
    });

    it('keeps a cost the provider already reported', () => {
        const { wrapped, events, manager } = setup({ costTracker: prices });
        wrapped.emit({ type: 'metrics', input_tokens: 1_000_000, output_tokens: 0, cost_usd: 0.42 });
        expect((events[0] as { cost_usd?: number }).cost_usd).toBe(0.42);
        manager.destroy();
    });

    it('each event carries its own batch cost, and the run total is not double counted', () => {
        const { wrapped, events, manager } = setup({ costTracker: prices });
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'metrics', input_tokens: 1_000_000, output_tokens: 0 });
        wrapped.emit({ type: 'token', content: 'x' });
        wrapped.emit({ type: 'metrics', input_tokens: 2_000_000, output_tokens: 0 });
        const costs = events.filter(e => e.type === 'metrics').map(e => (e as { cost_usd?: number }).cost_usd);
        expect(costs).toEqual([3, 6]);
        expect(manager.getRunCost()).toBeCloseTo(9, 6);
        expect(events.find(e => e.type === 'token')).toEqual({ type: 'token', content: 'x' });
        manager.destroy();
    });
});
