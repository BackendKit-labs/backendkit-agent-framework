import { MetricsCollector } from '../MetricsCollector';

describe('MetricsCollector', () => {
    let col: MetricsCollector;
    beforeEach(() => { col = new MetricsCollector(); });

    it('snapshot starts empty with null percentiles', () => {
        const snap = col.getSnapshot();
        expect(snap.runs.total).toBe(0);
        expect(snap.runs.errors).toBe(0);
        expect(snap.runs.p50Ms).toBeNull();
        expect(snap.runs.p95Ms).toBeNull();
        expect(snap.runs.p99Ms).toBeNull();
        expect(snap.tokens.totalInput).toBe(0);
        expect(snap.tokens.estimatedCostUsd).toBe(0);
    });

    it('recordRun accumulates total and errors', () => {
        col.recordRun(100, false);
        col.recordRun(200, true);
        const snap = col.getSnapshot();
        expect(snap.runs.total).toBe(2);
        expect(snap.runs.errors).toBe(1);
        expect(snap.runs.totalDurationMs).toBe(300);
    });

    it('percentiles are computed correctly', () => {
        // 10 values: 10, 20, 30, ..., 100
        for (let i = 1; i <= 10; i++) col.recordRun(i * 10, false);
        const snap = col.getSnapshot();
        expect(snap.runs.p50Ms).toBe(50);
        expect(snap.runs.p95Ms).toBe(100);
        expect(snap.runs.p99Ms).toBe(100);
    });

    it('recordTokens accumulates token counts and cost', () => {
        col.recordTokens(1000, 500, 0.005);
        col.recordTokens(2000, 1000, 0.010);
        const snap = col.getSnapshot();
        expect(snap.tokens.totalInput).toBe(3000);
        expect(snap.tokens.totalOutput).toBe(1500);
        expect(snap.tokens.estimatedCostUsd).toBeCloseTo(0.015);
    });

    it('recordToolCall tracks success and failure counts', () => {
        col.recordToolCall('read_file', true);
        col.recordToolCall('read_file', true);
        col.recordToolCall('write_file', false);
        const snap = col.getSnapshot();
        expect(snap.tools['read_file'].calls).toBe(2);
        expect(snap.tools['read_file'].successes).toBe(2);
        expect(snap.tools['read_file'].failures).toBe(0);
        expect(snap.tools['write_file'].failures).toBe(1);
    });

    it('recordAgentBlock accumulates invocations and duration', () => {
        col.recordAgentBlock('general', 1000);
        col.recordAgentBlock('general', 2000);
        col.recordAgentBlock('coder', 500);
        const snap = col.getSnapshot();
        expect(snap.agents['general'].invocations).toBe(2);
        expect(snap.agents['general'].totalDurationMs).toBe(3000);
        expect(snap.agents['coder'].invocations).toBe(1);
    });
});
