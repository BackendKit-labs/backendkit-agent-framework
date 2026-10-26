import type { MetricsSnapshot } from './types';

/**
 * Run durations are kept in a fixed-size uniform reservoir (Algorithm R): memory and the cost of a snapshot
 * stay constant however many runs are recorded. Percentiles are exact up to RESERVOIR_SIZE runs and an
 * unbiased estimate beyond that; `total` and `totalDurationMs` are always exact.
 */
const RESERVOIR_SIZE = 1_024;

export class MetricsCollector {
    private durations: number[] = [];
    private runCount = 0;
    private durationSum = 0;
    private errorRuns = 0;
    private totalInput = 0;
    private totalOutput = 0;
    private estimatedCostUsd = 0;
    private tools = new Map<string, { calls: number; successes: number; failures: number }>();
    private agents = new Map<string, { invocations: number; totalDurationMs: number }>();
    private guardrails = new Map<string, { redacted: number; blocked: number; errors: number }>();

    recordRun(durationMs: number, error: boolean): void {
        this.runCount++;
        this.durationSum += durationMs;
        if (this.durations.length < RESERVOIR_SIZE) {
            this.durations.push(durationMs);
        } else {
            const slot = Math.floor(Math.random() * this.runCount);
            if (slot < RESERVOIR_SIZE) this.durations[slot] = durationMs;
        }
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

    recordGuardrail(name: string, action: 'redact' | 'block' | 'error'): void {
        let g = this.guardrails.get(name);
        if (!g) { g = { redacted: 0, blocked: 0, errors: 0 }; this.guardrails.set(name, g); }
        if (action === 'redact') g.redacted++; else if (action === 'block') g.blocked++; else g.errors++;
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
                total: this.runCount,
                errors: this.errorRuns,
                totalDurationMs: this.durationSum,
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
            ...(this.guardrails.size > 0 ? { guardrails: Object.fromEntries(this.guardrails) } : {}),
        };
    }

    private percentile(sorted: number[], p: number): number | null {
        if (sorted.length === 0) return null;
        return sorted[Math.max(0, Math.ceil(sorted.length * p / 100) - 1)];
    }
}
