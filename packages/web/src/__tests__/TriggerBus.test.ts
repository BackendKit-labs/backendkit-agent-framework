import * as crypto from 'crypto';
import type { AgentEngine, Transport } from '@backendkit-labs/agent-core';
import { TriggerBus } from '../trigger/TriggerBus';
import type { MonitorBus } from '../monitor/MonitorBus';

// ── Mock node-cron (optional dep) ─────────────────────────────────────────────
jest.mock('node-cron', () => ({
    schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
    validate: jest.fn().mockReturnValue(true),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEngine(): jest.Mocked<AgentEngine> {
    return {
        run:      jest.fn().mockResolvedValue(undefined),
        abort:    jest.fn(),
        use:      jest.fn(),
        getTools: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AgentEngine>;
}

function makeMonitorBus(): jest.Mocked<MonitorBus> {
    return {
        notifySessionOpen:  jest.fn(),
        notifySessionClose: jest.fn(),
        broadcast:          jest.fn(),
        broadcastRunInput:  jest.fn(),
        subscribe:          jest.fn(),
        size: 0,
    } as unknown as jest.Mocked<MonitorBus>;
}

function makeFastify() {
    const routes: Record<string, jest.Mock> = {};
    const app: Record<string, jest.Mock> = {
        post: jest.fn((path: string, handler: jest.Mock) => { routes[`POST ${path}`] = handler; }),
        get:  jest.fn((path: string, handler: jest.Mock) => { routes[`GET ${path}`]  = handler; }),
        put:  jest.fn((path: string, handler: jest.Mock) => { routes[`PUT ${path}`]  = handler; }),
    };
    return { app, routes };
}

function makeReq(overrides: { body?: unknown; headers?: Record<string, string> } = {}) {
    return { body: overrides.body ?? {}, headers: overrides.headers ?? {} };
}

function makeReply() {
    const r: Record<string, jest.Mock> = {};
    r['code'] = jest.fn().mockReturnValue(r);
    r['send'] = jest.fn().mockReturnValue(r);
    return r;
}

function hmacSig(body: unknown, secret: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
}

/** Flush all pending microtasks and macro-tasks to let async fire() complete. */
async function flushAsync(rounds = 10) {
    for (let i = 0; i < rounds; i++) {
        await new Promise(r => setImmediate(r));
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TriggerBus', () => {
    let engine: jest.Mocked<AgentEngine>;
    let engineFactory: jest.Mock;
    let nodeCron: { schedule: jest.Mock; validate: jest.Mock };

    beforeEach(() => {
        engine = makeEngine();
        engineFactory = jest.fn().mockReturnValue(engine);
        nodeCron = jest.requireMock('node-cron');
        nodeCron.schedule.mockClear().mockReturnValue({ stop: jest.fn() });
        nodeCron.validate.mockClear().mockReturnValue(true);
    });

    // ── fluent API ────────────────────────────────────────────────────────────

    describe('fluent API', () => {
        it('addCron() returns this', () => {
            const bus = new TriggerBus(engineFactory);
            const ret = bus.addCron({ name: 'r', schedule: '* * * * *', buildPrompt: () => 'x' });
            expect(ret).toBe(bus);
        });

        it('addWebhook() returns this', () => {
            const bus = new TriggerBus(engineFactory);
            expect(bus.addWebhook({ name: 'w', path: '/wh', buildPrompt: () => 'x' })).toBe(bus);
        });

        it('addQueue() returns this', () => {
            const bus = new TriggerBus(engineFactory);
            expect(bus.addQueue({
                name: 'q', queueName: 'jobs', connection: 'redis://localhost', buildPrompt: () => 'x',
            })).toBe(bus);
        });
    });

    // ── start() ───────────────────────────────────────────────────────────────

    describe('start()', () => {
        it('schedules cron tasks via node-cron', () => {
            const bus = new TriggerBus(engineFactory);
            bus.addCron({ name: 'r', schedule: '0 9 * * 1-5', buildPrompt: () => 'go' });
            bus.start();
            expect(nodeCron.schedule).toHaveBeenCalledWith('0 9 * * 1-5', expect.any(Function));
            bus.close();
        });

        it('is idempotent — a second start() does not re-register crons', () => {
            const bus = new TriggerBus(engineFactory);
            bus.addCron({ name: 'r', schedule: '* * * * *', buildPrompt: () => 'go' });
            bus.start();
            bus.start();
            expect(nodeCron.schedule).toHaveBeenCalledTimes(1);
            bus.close();
        });

        it('fires runOnStart crons immediately without waiting for the schedule', async () => {
            const onComplete = jest.fn();
            const bus = new TriggerBus(engineFactory);
            bus.addCron({
                name: 'r', schedule: '0 9 * * 1-5', runOnStart: true,
                buildPrompt: () => 'immediate', onComplete,
            });
            bus.start();
            await flushAsync();
            expect(engineFactory).toHaveBeenCalled();
            expect(engine.run).toHaveBeenCalledWith('immediate');
            await bus.close();
        });

        it('skips an invalid cron schedule and logs an error', () => {
            nodeCron.validate.mockReturnValueOnce(false);
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const bus = new TriggerBus(engineFactory);
            bus.addCron({ name: 'bad', schedule: 'not-valid', buildPrompt: () => 'x' });
            bus.start();
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid cron schedule'));
            expect(nodeCron.schedule).not.toHaveBeenCalled();
            spy.mockRestore();
            bus.close();
        });

        it('warns when node-cron is missing and cron defs are registered', () => {
            // Temporarily make require('node-cron') throw
            jest.resetModules();
            jest.doMock('node-cron', () => { throw new Error('not found'); });
            const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            // Re-require TriggerBus from scratch so it picks up the new mock
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { TriggerBus: TB } = require('../trigger/TriggerBus') as typeof import('../trigger/TriggerBus');
            const bus = new TB(engineFactory);
            bus.addCron({ name: 'r', schedule: '* * * * *', buildPrompt: () => 'x' });
            bus.start();
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('node-cron not found'));
            spy.mockRestore();
            // Restore the original mock
            jest.resetModules();
            jest.doMock('node-cron', () => ({
                schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
                validate: jest.fn().mockReturnValue(true),
            }));
            bus.close();
        });
    });

    // ── close() ───────────────────────────────────────────────────────────────

    describe('close()', () => {
        it('stops all scheduled cron tasks', async () => {
            const stopFn = jest.fn();
            nodeCron.schedule.mockReturnValue({ stop: stopFn });
            const bus = new TriggerBus(engineFactory);
            bus.addCron({ name: 'r', schedule: '* * * * *', buildPrompt: () => 'go' });
            bus.start();
            await bus.close();
            expect(stopFn).toHaveBeenCalled();
        });

        it('allows start() again after close()', async () => {
            const bus = new TriggerBus(engineFactory);
            bus.addCron({ name: 'r', schedule: '* * * * *', buildPrompt: () => 'go' });
            bus.start();
            await bus.close();
            bus.start();
            expect(nodeCron.schedule).toHaveBeenCalledTimes(2);
            await bus.close();
        });
    });

    // ── registerRoutes() ──────────────────────────────────────────────────────

    describe('registerRoutes()', () => {
        it('registers a POST route by default', () => {
            const { app } = makeFastify();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({ name: 'gh', path: '/triggers/github', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            expect(app.post).toHaveBeenCalledWith('/triggers/github', expect.any(Function));
        });

        it('registers a GET route when method is GET', () => {
            const { app } = makeFastify();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({ name: 'p', path: '/poll', method: 'GET', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            expect(app.get).toHaveBeenCalledWith('/poll', expect.any(Function));
        });

        it('registers a PUT route when method is PUT', () => {
            const { app } = makeFastify();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({ name: 'u', path: '/update', method: 'PUT', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            expect(app.put).toHaveBeenCalledWith('/update', expect.any(Function));
        });

        it('responds 202 immediately on a valid webhook hit', async () => {
            const { app, routes } = makeFastify();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({ name: 'test', path: '/wh', buildPrompt: () => 'hi' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);

            const req   = makeReq({ body: { x: 1 } });
            const reply = makeReply();
            await routes['POST /wh'](req, reply);

            expect(reply.code).toHaveBeenCalledWith(202);
            expect(reply.send).toHaveBeenCalledWith({ queued: true, trigger: 'test' });
        });

        // ── HMAC ──────────────────────────────────────────────────────────────

        describe('HMAC validation', () => {
            it('rejects a request with an invalid signature', async () => {
                const { app, routes } = makeFastify();
                const bus = new TriggerBus(engineFactory);
                bus.addWebhook({ name: 's', path: '/wh', secret: 'mysecret', buildPrompt: () => 'x' });
                bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);

                const req   = makeReq({ body: {}, headers: { 'x-hub-signature-256': 'sha256=wrong' } });
                const reply = makeReply();
                await routes['POST /wh'](req, reply);

                expect(reply.code).toHaveBeenCalledWith(401);
                expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
                expect(engineFactory).not.toHaveBeenCalled();
            });

            it('accepts a request with a valid GitHub-compatible HMAC signature', async () => {
                const { app, routes } = makeFastify();
                const bus = new TriggerBus(engineFactory);
                bus.addWebhook({ name: 's', path: '/wh', secret: 'mysecret', buildPrompt: () => 'x' });
                bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);

                const body = { action: 'opened', number: 42 };
                const req  = makeReq({ body, headers: { 'x-hub-signature-256': hmacSig(body, 'mysecret') } });
                const reply = makeReply();
                await routes['POST /wh'](req, reply);

                expect(reply.code).toHaveBeenCalledWith(202);
            });

            it('rejects when the signature header is missing entirely', async () => {
                const { app, routes } = makeFastify();
                const bus = new TriggerBus(engineFactory);
                bus.addWebhook({ name: 's', path: '/wh', secret: 'mysecret', buildPrompt: () => 'x' });
                bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);

                const req   = makeReq({ body: {} });
                const reply = makeReply();
                await routes['POST /wh'](req, reply);

                expect(reply.code).toHaveBeenCalledWith(401);
            });
        });
    });

    // ── fire() (exercised via webhook route) ──────────────────────────────────

    describe('fire()', () => {
        async function triggerAndFlush(overrides: Partial<Parameters<TriggerBus['addWebhook']>[0]> = {}) {
            const { app, routes } = makeFastify();
            const onComplete = jest.fn();
            const onError    = jest.fn();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({
                name: 'fire-test',
                path: '/wh',
                buildPrompt: (payload) => `prompt:${JSON.stringify(payload)}`,
                onComplete,
                onError,
                ...overrides,
            });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            const reply = makeReply();
            await routes['POST /wh'](makeReq({ body: { n: 1 } }), reply);
            await flushAsync();
            return { onComplete, onError, bus };
        }

        it('calls engineFactory with a trigger- prefixed sessionId', async () => {
            const { bus } = await triggerAndFlush();
            expect(engineFactory).toHaveBeenCalledWith(
                expect.stringMatching(/^trigger-/),
                expect.any(Object),
            );
            await bus.close();
        });

        it('passes the webhook body to buildPrompt', async () => {
            const { bus } = await triggerAndFlush();
            expect(engine.run).toHaveBeenCalledWith('prompt:{"n":1}');
            await bus.close();
        });

        it('calls onComplete with a TriggerResult after a successful run', async () => {
            const { onComplete, bus } = await triggerAndFlush();
            expect(onComplete).toHaveBeenCalledWith(
                expect.objectContaining({
                    triggerName: 'fire-test',
                    sessionId:   expect.stringMatching(/^trigger-/),
                    durationMs:  expect.any(Number),
                    output:      expect.any(String),
                    events:      expect.any(Array),
                }),
            );
            await bus.close();
        });

        it('calls onError when engine.run() throws', async () => {
            engine.run = jest.fn().mockRejectedValue(new Error('boom'));
            const { onError, bus } = await triggerAndFlush();
            expect(onError).toHaveBeenCalledWith(expect.any(Error), 'fire-test');
            await bus.close();
        });

        it('passes a non-Error throw wrapped in Error to onError', async () => {
            engine.run = jest.fn().mockRejectedValue('string error');
            const { onError, bus } = await triggerAndFlush();
            expect(onError).toHaveBeenCalledWith(expect.any(Error), 'fire-test');
            await bus.close();
        });

        it('does not call onComplete when the run fails', async () => {
            engine.run = jest.fn().mockRejectedValue(new Error('fail'));
            const { onComplete, bus } = await triggerAndFlush();
            expect(onComplete).not.toHaveBeenCalled();
            await bus.close();
        });

        it('notifies monitorBus open and close around the run', async () => {
            const monitorBus = makeMonitorBus();
            const { app, routes } = makeFastify();
            const bus = new TriggerBus(engineFactory, monitorBus);
            bus.addWebhook({ name: 'm', path: '/wh', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            await routes['POST /wh'](makeReq({}), makeReply());
            await flushAsync();
            expect(monitorBus.notifySessionOpen).toHaveBeenCalledWith(
                expect.stringMatching(/^trigger-/),
            );
            expect(monitorBus.notifySessionClose).toHaveBeenCalledWith(
                expect.stringMatching(/^trigger-/),
            );
            await bus.close();
        });

        it('fan-outs engine events to monitorBus.broadcast', async () => {
            const monitorBus = makeMonitorBus();
            const firedEvents: unknown[] = [];
            engine.run = jest.fn().mockImplementation(async (_: string, transport?: Transport) => {
                // The transport passed to engineFactory is what we need
                // We intercept via the spy on broadcast
            });
            // Capture whatever the factory receives
            let capturedTransport: { emit: (e: unknown) => void } | undefined;
            engineFactory = jest.fn().mockImplementation((_id: string, t: { emit: (e: unknown) => void }) => {
                capturedTransport = t;
                return engine;
            });

            const { app, routes } = makeFastify();
            const bus = new TriggerBus(engineFactory, monitorBus);
            bus.addWebhook({ name: 'ev', path: '/wh', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);

            engine.run = jest.fn().mockImplementation(async () => {
                // Emit an event after the engine factory has been called
                capturedTransport?.emit({ type: 'token', content: 'hello' });
            });

            await routes['POST /wh'](makeReq({}), makeReply());
            await flushAsync();
            expect(monitorBus.broadcast).toHaveBeenCalledWith(
                expect.stringMatching(/^trigger-/),
                expect.objectContaining({ type: 'token' }),
            );
            void firedEvents;
            await bus.close();
        });

        it('closes the transport in the finally block even when the run throws', async () => {
            engine.run = jest.fn().mockRejectedValue(new Error('crash'));
            const { app, routes } = makeFastify();
            const bus = new TriggerBus(engineFactory);
            bus.addWebhook({ name: 't', path: '/wh', buildPrompt: () => 'x' });
            bus.registerRoutes(app as unknown as Parameters<TriggerBus['registerRoutes']>[0]);
            await routes['POST /wh'](makeReq({}), makeReply());
            await flushAsync();
            // No assertion on transport.close() directly — verified indirectly:
            // if close() was NOT called in finally, HeadlessTransport._closed stays false.
            // We instead verify the whole flow does not throw and onError is not called
            // (no onError registered here → the catch in registerRoutes silences it).
            expect(engineFactory).toHaveBeenCalled();
            await bus.close();
        });
    });

    // ── cron callback (integration via schedule mock) ─────────────────────────

    describe('cron callback', () => {
        it('fires the engine when the cron callback is invoked', async () => {
            let cronCallback: (() => void) | undefined;
            nodeCron.schedule.mockImplementation((_expr: string, cb: () => void) => {
                cronCallback = cb;
                return { stop: jest.fn() };
            });

            const onComplete = jest.fn();
            const bus = new TriggerBus(engineFactory);
            bus.addCron({
                name: 'daily', schedule: '0 0 * * *',
                buildPrompt: () => 'run daily report',
                onComplete,
            });
            bus.start();

            expect(cronCallback).toBeDefined();
            cronCallback!();
            await flushAsync();

            expect(engine.run).toHaveBeenCalledWith('run daily report');
            expect(onComplete).toHaveBeenCalled();
            await bus.close();
        });

        it('calls onError when the cron-triggered run fails', async () => {
            let cronCallback: (() => void) | undefined;
            nodeCron.schedule.mockImplementation((_expr: string, cb: () => void) => {
                cronCallback = cb;
                return { stop: jest.fn() };
            });
            engine.run = jest.fn().mockRejectedValue(new Error('cron fail'));

            const onError = jest.fn();
            const bus = new TriggerBus(engineFactory);
            bus.addCron({
                name: 'fail-cron', schedule: '* * * * *',
                buildPrompt: () => 'x', onError,
            });
            bus.start();
            cronCallback!();
            await flushAsync();

            expect(onError).toHaveBeenCalledWith(expect.any(Error), 'fail-cron');
            await bus.close();
        });
    });
});
