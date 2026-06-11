import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export interface MetricsCollectorOptions {
    /** Prefix for all metric names. Default: 'bk'. */
    prefix?: string;
    /** Include Node.js default metrics (memory, CPU, GC). Default: true. */
    collectNodeMetrics?: boolean;
}

export type RunEndFn = (status?: 'success' | 'error') => void;

/**
 * Prometheus metrics collector for AgentServer.
 *
 * Exposes:
 *   {prefix}_sessions_active      — gauge: live WebSocket sessions
 *   {prefix}_sessions_total       — counter: all sessions created
 *   {prefix}_messages_total       — counter: user input messages received
 *   {prefix}_runs_total{status}   — counter: agent runs by status (success|error)
 *   {prefix}_run_duration_seconds — histogram: agent run wall time
 *
 * Usage:
 *   const server = new AgentServer({
 *     metrics: { enabled: true },   // exposes GET /metrics
 *     ...
 *   });
 */
export class MetricsCollector {
    private readonly registry: Registry;
    private readonly sessionsActive: Gauge;
    private readonly sessionsTotal: Counter;
    private readonly messagesTotal: Counter;
    private readonly runsTotal: Counter;
    private readonly runDuration: Histogram;

    constructor(opts: MetricsCollectorOptions = {}) {
        const prefix = opts.prefix ?? 'bk';
        this.registry = new Registry();

        if (opts.collectNodeMetrics !== false) {
            collectDefaultMetrics({ register: this.registry, prefix: `${prefix}_node_` });
        }

        this.sessionsActive = new Gauge({
            name: `${prefix}_sessions_active`,
            help: 'Number of currently active WebSocket sessions',
            registers: [this.registry],
        });

        this.sessionsTotal = new Counter({
            name: `${prefix}_sessions_total`,
            help: 'Total WebSocket sessions created since startup',
            registers: [this.registry],
        });

        this.messagesTotal = new Counter({
            name: `${prefix}_messages_total`,
            help: 'Total user input messages received',
            registers: [this.registry],
        });

        this.runsTotal = new Counter({
            name: `${prefix}_runs_total`,
            help: 'Total agent runs executed',
            labelNames: ['status'] as const,
            registers: [this.registry],
        });

        this.runDuration = new Histogram({
            name: `${prefix}_run_duration_seconds`,
            help: 'Agent run duration in seconds',
            buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
            registers: [this.registry],
        });
    }

    sessionOpened(): void {
        this.sessionsActive.inc();
        this.sessionsTotal.inc();
    }

    sessionClosed(): void {
        this.sessionsActive.dec();
    }

    messageReceived(): void {
        this.messagesTotal.inc();
    }

    /**
     * Call at the start of a run. Returns a finish function to call when done.
     *
     *   const finish = metrics.runStarted();
     *   try { await engine.run(input); finish(); }
     *   catch { finish('error'); }
     */
    runStarted(): RunEndFn {
        const startMs = Date.now();
        return (status: 'success' | 'error' = 'success') => {
            const durationSec = (Date.now() - startMs) / 1000;
            this.runsTotal.labels(status).inc();
            this.runDuration.observe(durationSec);
        };
    }

    async collect(): Promise<string> {
        return this.registry.metrics();
    }

    get contentType(): string {
        return this.registry.contentType;
    }
}
