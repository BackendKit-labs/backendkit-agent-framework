import { ObservabilityManager } from '../ObservabilityManager';
import type { AgentEvent } from '../../types';
import type { MetricsSnapshot } from '../types';
import { createMockTransport } from '../../__tests__/helpers';

function makeManager(config = {}) {
    return new ObservabilityManager(config);
}

describe('ObservabilityManager.wrapTransport', () => {
    it('proxies emit to the inner transport', () => {
        const { transport: inner, events } = createMockTransport();
        const manager = makeManager();
        const wrapped = manager.wrapTransport(inner);
        wrapped.emit({ type: 'ready' });
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('ready');
        manager.destroy();
    });

    it('proxies onInput and close to inner transport', () => {
        let onInputCalled = false;
        let closeCalled = false;
        const inner = {
            emit: () => undefined,
            onInput: (_h: unknown) => { onInputCalled = true; return () => undefined; },
            close: () => { closeCalled = true; },
        };
        const manager = makeManager();
        const wrapped = manager.wrapTransport(inner);
        wrapped.onInput(() => undefined);
        wrapped.close();
        expect(onInputCalled).toBe(true);
        expect(closeCalled).toBe(true);
        manager.destroy();
    });
});

describe('ObservabilityManager — metrics', () => {
    it('getMetricsSnapshot returns null when metrics not configured', () => {
        const manager = makeManager();
        expect(manager.getMetricsSnapshot()).toBeNull();
        manager.destroy();
    });

    it('records run duration on ready + done', () => {
        const { transport } = createMockTransport();
        const snaps: unknown[] = [];
        const manager = makeManager({
            metrics: { onSnapshot: (s: MetricsSnapshot) => snaps.push(s) },
        });
        const wrapped = manager.wrapTransport(transport);
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'done' });
        const snap = manager.getMetricsSnapshot()!;
        expect(snap.runs.total).toBe(1);
        expect(snap.runs.errors).toBe(0);
        manager.destroy();
    });

    it('counts run as error on error event', () => {
        const { transport } = createMockTransport();
        const manager = makeManager({ metrics: {} });
        const wrapped = manager.wrapTransport(transport);
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'error', message: 'oops' });
        wrapped.emit({ type: 'done' });
        const snap = manager.getMetricsSnapshot()!;
        expect(snap.runs.errors).toBe(1);
        manager.destroy();
    });

    it('records tool call results', () => {
        const { transport } = createMockTransport();
        const manager = makeManager({ metrics: {} });
        const wrapped = manager.wrapTransport(transport);
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'tool_result', name: 'read_file', success: true, preview: '' });
        wrapped.emit({ type: 'tool_result', name: 'read_file', success: false, preview: '' });
        wrapped.emit({ type: 'done' });
        const snap = manager.getMetricsSnapshot()!;
        expect(snap.tools['read_file'].calls).toBe(2);
        expect(snap.tools['read_file'].successes).toBe(1);
        manager.destroy();
    });
});

describe('ObservabilityManager — cost tracking', () => {
    it('getRunCost returns 0 with no pricing', () => {
        const manager = makeManager();
        expect(manager.getRunCost()).toBe(0);
        manager.destroy();
    });

    it('updates cost on metrics event', () => {
        const { transport } = createMockTransport();
        const exceeded: unknown[] = [];
        const manager = makeManager({
            costTracker: {
                inputPricePerMToken: 3,
                outputPricePerMToken: 15,
                budget: { perRun: 100 },
                onBudgetExceeded: (u: unknown) => exceeded.push(u),
            },
        });
        const wrapped = manager.wrapTransport(transport);
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'metrics', input_tokens: 1_000, output_tokens: 1_000 });
        expect(manager.getRunCost()).toBeGreaterThan(0);
        manager.destroy();
    });
});

describe('ObservabilityManager — tracing', () => {
    it('console exporter emits span log for each run', () => {
        const logs: string[] = [];
        const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
            logs.push(args.join(' '));
        });

        const { transport } = createMockTransport();
        const manager = makeManager({ tracing: { exporter: 'console' } });
        const wrapped = manager.wrapTransport(transport);
        wrapped.emit({ type: 'ready' });
        wrapped.emit({ type: 'done' });

        expect(logs.some(l => l.includes('[TRACE]') && l.includes('run'))).toBe(true);
        spy.mockRestore();
        manager.destroy();
    });
});
