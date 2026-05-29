import type { MetricsSnapshot } from './types';

export class MetricsCollector {
    private durations: number[] = [];
    private errorRuns = 0;
    private totalInput = 0;
    private totalOutput = 0;
    private estimatedCostUsd = 0;
    private tools = new Map<string, { calls: number; successes: number; failures: number }>();
    private agents = new Map<string, { invocations: number; totalDurationMs: number }>();

    recordRun(durationMs: number, error: boolean): void {
        this.durations.push(durationMs);
        if (error) this.errorRuns++;
    }

    recordTokens(input: number, output: number, costUsd: number): void {
        this.totalInput += input;
        this.totalOutput += output;
        this.estimatedCostUsd += costUsd;
    }

    recordToolCall(name: string, success: boolean): void {
        let t = this.tools.get(name);
        if (!t) { t = { calls: 0, successes: 0, failures: 0 }; this.tools.set(name, t); }
        t.calls++;
        if (success) t.successes++; else t.failures++;
    }

    recordAgentBlock(agentId: string, durationMs: number): void {
        let a = this.agents.get(agentId);
        if (!a) { a = { invocations: 0, totalDurationMs: 0 }; this.agents.set(agentId, a); }
        a.invocations++;
        a.totalDurationMs += durationMs;
    }

    getSnapshot(): MetricsSnapshot {
        const sorted = [...this.durations].sort((a, b) => a - b);
        return {
            runs: {
                total: this.durations.length,
                errors: this.errorRuns,
                totalDurationMs: this.durations.reduce((s, d) => s + d, 0),
                p50Ms: this.percentile(sorted, 50),
                p95Ms: this.percentile(sorted, 95),
                p99Ms: this.percentile(sorted, 99),
            },
            tokens: {
                totalInput: this.totalInput,
                totalOutput: this.totalOutput,
                estimatedCostUsd: this.estimatedCostUsd,
            },
            tools: Object.fromEntries(this.tools),
            agents: Object.fromEntries(this.agents),
        };
    }

    private percentile(sorted: number[], p: number): number | null {
        if (sorted.length === 0) return null;
        return sorted[Math.max(0, Math.ceil(sorted.length * p / 100) - 1)];
    }
}
