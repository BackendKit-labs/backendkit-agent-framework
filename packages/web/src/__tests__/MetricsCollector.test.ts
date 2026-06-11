import { MetricsCollector } from '../metrics/MetricsCollector';

// prom-client keeps a global default registry that persists between tests.
// We always pass collectNodeMetrics: false and use a fresh instance per test
// so metrics from one test never bleed into another.

function make(prefix = 'test') {
    return new MetricsCollector({ prefix, collectNodeMetrics: false });
}

async function getMetric(mc: MetricsCollector, name: string): Promise<string> {
    const output = await mc.collect();
    return output
        .split('\n')
        .filter(l => l.startsWith(name) && !l.startsWith('#'))
        .join('\n');
}

async function getCounterValue(mc: MetricsCollector, name: string, labels = ''): Promise<number> {
    const output = await mc.collect();
    const key    = labels ? `${name}{${labels}}` : name;
    const line   = output.split('\n').find(l => l.startsWith(key + ' ') || l === key);
    if (!line) return 0;
    return parseFloat(line.split(' ').pop()!);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MetricsCollector', () => {

    // ── constructor ───────────────────────────────────────────────────────────

    describe('constructor', () => {
        it('uses "bk" as the default prefix', async () => {
            const mc     = new MetricsCollector({ collectNodeMetrics: false });
            const output = await mc.collect();
            expect(output).toContain('bk_sessions_active');
            expect(output).toContain('bk_sessions_total');
        });

        it('uses a custom prefix when provided', async () => {
            const mc     = new MetricsCollector({ prefix: 'myapp', collectNodeMetrics: false });
            const output = await mc.collect();
            expect(output).toContain('myapp_sessions_active');
            expect(output).toContain('myapp_sessions_total');
        });

        it('exposes all five metric families', async () => {
            const mc     = make();
            const output = await mc.collect();
            expect(output).toContain('test_sessions_active');
            expect(output).toContain('test_sessions_total');
            expect(output).toContain('test_messages_total');
            expect(output).toContain('test_runs_total');
            expect(output).toContain('test_run_duration_seconds');
        });

        it('does not include node default metrics when collectNodeMetrics is false', async () => {
            const mc     = make();
            const output = await mc.collect();
            expect(output).not.toContain('nodejs_');
        });
    });

    // ── sessionOpened() ───────────────────────────────────────────────────────

    describe('sessionOpened()', () => {
        it('increments sessions_active', async () => {
            const mc = make();
            mc.sessionOpened();
            expect(await getCounterValue(mc, 'test_sessions_active')).toBe(1);
        });

        it('increments sessions_total', async () => {
            const mc = make();
            mc.sessionOpened();
            expect(await getCounterValue(mc, 'test_sessions_total')).toBe(1);
        });

        it('increments both counters for each call', async () => {
            const mc = make();
            mc.sessionOpened();
            mc.sessionOpened();
            mc.sessionOpened();
            expect(await getCounterValue(mc, 'test_sessions_active')).toBe(3);
            expect(await getCounterValue(mc, 'test_sessions_total')).toBe(3);
        });
    });

    // ── sessionClosed() ───────────────────────────────────────────────────────

    describe('sessionClosed()', () => {
        it('decrements sessions_active', async () => {
            const mc = make();
            mc.sessionOpened();
            mc.sessionOpened();
            mc.sessionClosed();
            expect(await getCounterValue(mc, 'test_sessions_active')).toBe(1);
        });

        it('does not affect sessions_total', async () => {
            const mc = make();
            mc.sessionOpened();
            mc.sessionOpened();
            mc.sessionClosed();
            expect(await getCounterValue(mc, 'test_sessions_total')).toBe(2);
        });

        it('active gauge reaches zero when all sessions close', async () => {
            const mc = make();
            mc.sessionOpened();
            mc.sessionOpened();
            mc.sessionClosed();
            mc.sessionClosed();
            expect(await getCounterValue(mc, 'test_sessions_active')).toBe(0);
        });
    });

    // ── messageReceived() ─────────────────────────────────────────────────────

    describe('messageReceived()', () => {
        it('increments messages_total', async () => {
            const mc = make();
            mc.messageReceived();
            expect(await getCounterValue(mc, 'test_messages_total')).toBe(1);
        });

        it('accumulates across multiple calls', async () => {
            const mc = make();
            mc.messageReceived();
            mc.messageReceived();
            mc.messageReceived();
            expect(await getCounterValue(mc, 'test_messages_total')).toBe(3);
        });
    });

    // ── runStarted() / RunEndFn ───────────────────────────────────────────────

    describe('runStarted()', () => {
        it('returns a finish function', () => {
            const mc     = make();
            const finish = mc.runStarted();
            expect(typeof finish).toBe('function');
        });

        it('increments runs_total{status="success"} on finish() with no argument', async () => {
            const mc     = make();
            const finish = mc.runStarted();
            finish();
            const output = await mc.collect();
            expect(output).toContain('test_runs_total{status="success"} 1');
        });

        it('increments runs_total{status="success"} when called with "success"', async () => {
            const mc     = make();
            const finish = mc.runStarted();
            finish('success');
            const output = await mc.collect();
            expect(output).toContain('test_runs_total{status="success"} 1');
        });

        it('increments runs_total{status="error"} when called with "error"', async () => {
            const mc     = make();
            const finish = mc.runStarted();
            finish('error');
            const output = await mc.collect();
            expect(output).toContain('test_runs_total{status="error"} 1');
        });

        it('tracks success and error runs independently', async () => {
            const mc = make();
            mc.runStarted()('success');
            mc.runStarted()('success');
            mc.runStarted()('error');
            const output = await mc.collect();
            expect(output).toContain('test_runs_total{status="success"} 2');
            expect(output).toContain('test_runs_total{status="error"} 1');
        });

        it('records a non-negative duration in the histogram', async () => {
            const mc     = make();
            const finish = mc.runStarted();
            await new Promise(r => setTimeout(r, 10));
            finish();
            const output = await mc.collect();
            // histogram _sum should be > 0
            const sumLine = output.split('\n').find(l => l.startsWith('test_run_duration_seconds_sum '));
            expect(sumLine).toBeDefined();
            const sum = parseFloat(sumLine!.split(' ')[1]);
            expect(sum).toBeGreaterThan(0);
        });

        it('each finish call records its own observation', async () => {
            const mc = make();
            mc.runStarted()();
            mc.runStarted()();
            const output = await mc.collect();
            const countLine = output.split('\n').find(l => l.startsWith('test_run_duration_seconds_count '));
            expect(countLine).toBeDefined();
            expect(parseFloat(countLine!.split(' ')[1])).toBe(2);
        });

        it('does not increment runs_total before finish is called', async () => {
            const mc = make();
            mc.runStarted(); // not finished
            const output = await mc.collect();
            // runs_total lines should not appear or be 0
            const lines = output.split('\n').filter(
                l => l.startsWith('test_runs_total{') && !l.startsWith('#'),
            );
            const total = lines.reduce((sum, l) => sum + parseFloat(l.split(' ').pop()!), 0);
            expect(total).toBe(0);
        });
    });

    // ── collect() ────────────────────────────────────────────────────────────

    describe('collect()', () => {
        it('returns a non-empty string', async () => {
            const output = await make().collect();
            expect(typeof output).toBe('string');
            expect(output.length).toBeGreaterThan(0);
        });

        it('returns valid Prometheus text format (lines starting with # HELP or metric)', async () => {
            const output = await make().collect();
            const lines  = output.split('\n').filter(Boolean);
            expect(lines.some(l => l.startsWith('# HELP'))).toBe(true);
            expect(lines.some(l => l.startsWith('# TYPE'))).toBe(true);
        });
    });

    // ── contentType ──────────────────────────────────────────────────────────

    describe('contentType', () => {
        it('returns the Prometheus text content-type string', () => {
            const ct = make().contentType;
            expect(ct).toContain('text/plain');
            expect(ct).toContain('version=0.0.4');
        });
    });
});
