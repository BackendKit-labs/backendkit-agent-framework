import * as http from 'node:http';
import * as net from 'node:net';
import { AgentServer, AgentClient } from '../index';
import type { CapabilityDefinition } from '../index';

const def = (name: string, async = false): CapabilityDefinition => ({
    name, description: name, async, input: {}, output: {},
});

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as net.AddressInfo;
            s.close(() => resolve(port));
        });
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('AgentServer + AgentClient (HTTP real)', () => {
    let server: AgentServer;
    let url: string;
    let flakyCalls = 0;
    let badInputCalls = 0;
    let release: () => void;

    beforeAll(async () => {
        const port = await freePort();
        url = `http://127.0.0.1:${port}`;
        server = new AgentServer({ name: 'test-agent', version: '1.2.3', description: 'd', port, apiKey: 'k3y' });
        server
            .register({ definition: def('echo'), execute: async (input, ctx) => ({ input, tenant: ctx.tenantId }) })
            .register({ definition: def('boom'), execute: async () => { throw new Error('kaput'); } })
            .register({ definition: def('flaky'), execute: async () => { flakyCalls++; throw new Error('transient'); } })
            .register({ definition: def('bad-input'), execute: async () => { badInputCalls++; return 'unreachable'; } })
            .register({ definition: def('slow', true), execute: async () => { await new Promise<void>(r => { release = r; }); return 'finished'; } })
            .register({ definition: def('quick-async', true), execute: async () => 'async-result' });
        await server.start();
    });

    afterAll(async () => { await server.stop(); });

    const raw = (path: string, init: RequestInit = {}) =>
        fetch(`${url}${path}`, { ...init, headers: { Authorization: 'Bearer k3y', 'Content-Type': 'application/json', ...(init.headers as object) } });

    describe('server', () => {
        it('health is public', async () => {
            const res = await fetch(`${url}/v1/agent/health`);
            expect(res.status).toBe(200);
            expect(await json(res)).toMatchObject({ ok: true, data: { status: 'ok' } });
        });

        it.each([
            ['no header', {}],
            ['wrong key', { Authorization: 'Bearer nope' }],
            ['wrong scheme', { Authorization: 'Basic k3y' }],
        ])('rejects %s with 401 UNAUTHORIZED', async (_l, headers) => {
            const res = await fetch(`${url}/v1/agent/info`, { headers: headers as Record<string, string> });
            expect(res.status).toBe(401);
            expect((await json(res)).error.code).toBe('UNAUTHORIZED');
        });

        it('info lists registered capabilities and version', async () => {
            const body = await json(await raw('/v1/agent/info'));
            expect(body.data.name).toBe('test-agent');
            expect(body.meta.agentVersion).toBe('1.2.3');
            expect(body.data.capabilities.map((c: CapabilityDefinition) => c.name)).toContain('echo');
        });

        it('run without capability -> 400 INVALID_INPUT', async () => {
            const res = await raw('/v1/agent/run', { method: 'POST', body: JSON.stringify({}) });
            expect(res.status).toBe(400);
            expect((await json(res)).error.code).toBe('INVALID_INPUT');
        });

        it('unknown capability -> 404 CAPABILITY_NOT_FOUND', async () => {
            const res = await raw('/v1/agent/run', { method: 'POST', body: JSON.stringify({ capability: 'ghost' }) });
            expect(res.status).toBe(404);
            expect((await json(res)).error.code).toBe('CAPABILITY_NOT_FOUND');
        });

        it('handler error -> 500 EXECUTION_FAILED with message and traceId', async () => {
            const res = await raw('/v1/agent/run', {
                method: 'POST', headers: { 'X-Trace-ID': 'trace-1' },
                body: JSON.stringify({ capability: 'boom', input: {} }),
            });
            expect(res.status).toBe(500);
            const body = await json(res);
            expect(body.error).toMatchObject({ code: 'EXECUTION_FAILED', message: 'kaput' });
            expect(body.meta.traceId).toBe('trace-1');
        });

        it('malformed JSON body returns a protocol envelope, not an HTML page', async () => {
            const res = await raw('/v1/agent/run', { method: 'POST', body: '{not json' });
            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(res.status).toBeLessThan(500);
            const body = await json(res);
            expect(body).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        });

        it('unknown route -> 404 envelope', async () => {
            const res = await raw('/v1/agent/nope');
            expect(res.status).toBe(404);
            expect((await json(res)).ok).toBe(false);
        });

        it('unknown task id -> 404 TASK_NOT_FOUND on GET and DELETE', async () => {
            for (const method of ['GET', 'DELETE']) {
                const res = await raw('/v1/agent/tasks/missing', { method });
                expect(res.status).toBe(404);
                expect((await json(res)).error.code).toBe('TASK_NOT_FOUND');
            }
        });
    });

    describe('client', () => {
        const client = () => new AgentClient({ url, apiKey: 'k3y', tenantId: 'acme', maxRetries: 1, circuitBreaker: false });

        it('health() true when reachable, false when not', async () => {
            expect(await client().health()).toBe(true);
            const dead = new AgentClient({ url: `http://127.0.0.1:${await freePort()}`, maxRetries: 0, circuitBreaker: false });
            expect(await dead.health()).toBe(false);
        });

        it('info() returns agent info', async () => {
            expect((await client().info()).name).toBe('test-agent');
        });

        it('run() sends input and the tenant header', async () => {
            const out = await client().run('echo', { a: 1 });
            expect(out).toMatchObject({ status: 'done', output: { input: { a: 1 }, tenant: 'acme' } });
        });

        it('per-call context overrides the default tenant', async () => {
            const out = await client().run('echo', {}, { context: { tenantId: 'other' } });
            expect((out.output as { tenant: string }).tenant).toBe('other');
        });

        it('4xx is permanent: a single attempt, error carries code and status', async () => {
            await expect(client().run('ghost', {})).rejects.toMatchObject({ status: 404 });
        });

        it('a 5xx is NOT repeated by default: the first attempt may have already run the capability', async () => {
            flakyCalls = 0;
            await expect(client().run('flaky', {})).rejects.toThrow();
            expect(flakyCalls).toBe(1);
        });

        it('runAndWait() does not repeat a failed start either', async () => {
            flakyCalls = 0;
            await expect(client().runAndWait('flaky', {})).rejects.toThrow();
            expect(flakyCalls).toBe(1);
        });

        it('with idempotent: true a 5xx is retried up to maxRetries + 1 attempts', async () => {
            flakyCalls = 0;
            await expect(client().run('flaky', {}, { idempotent: true })).rejects.toThrow();
            expect(flakyCalls).toBe(2);
        }, 15_000);

        describe('against a server that misbehaves on the wire', () => {
            let upstream: http.Server;
            let base: string;
            let calls = 0;
            let mode: 'drop' | '429-then-ok' = 'drop';

            beforeEach(async () => {
                calls = 0;
                upstream = http.createServer((req, res) => {
                    calls++;
                    req.resume();
                    if (mode === 'drop') { req.socket.destroy(); return; }
                    if (calls === 1) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } })); return; }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, data: { status: 'done', output: 'ran' } }));
                });
                await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
                base = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
            });
            afterEach(async () => { await new Promise<void>(r => upstream.close(() => r())); });

            it('a dropped connection is not repeated by default', async () => {
                mode = 'drop';
                const c = new AgentClient({ url: base, maxRetries: 2, circuitBreaker: false });
                await expect(c.run('anything', {})).rejects.toThrow();
                expect(calls).toBe(1);
            }, 30_000);

            it('a 429 is repeated even when the capability is not idempotent: it was refused, not run', async () => {
                mode = '429-then-ok';
                const c = new AgentClient({ url: base, maxRetries: 2, circuitBreaker: false });
                await expect(c.run('anything', {})).resolves.toMatchObject({ status: 'done', output: 'ran' });
                expect(calls).toBe(2);
            }, 15_000);
        });

        it('wrong api key is not retried', async () => {
            badInputCalls = 0;
            const c = new AgentClient({ url, apiKey: 'bad', maxRetries: 3, circuitBreaker: false });
            await expect(c.run('bad-input', {})).rejects.toMatchObject({ status: 401 });
            expect(badInputCalls).toBe(0);
        });

        it('runAndWait() polls an async capability until done', async () => {
            const out = await client().runAndWait('quick-async', {}, { pollInterval: 20 });
            expect(out).toBe('async-result');
        });

        it('runAndWait() times out with code TIMEOUT', async () => {
            await expect(client().runAndWait('slow', {}, { pollInterval: 20, maxWait: 100 }))
                .rejects.toMatchObject({ code: 'TIMEOUT' });
            release?.();
        });

        it('cancel() marks a running task cancelled and it stays cancelled after the handler finishes', async () => {
            const c = client();
            const started = await c.run('slow', {});
            expect(started.status).toBe('running');
            await wait(30);
            await c.cancel(started.taskId!);
            expect((await c.poll(started.taskId!)).status).toBe('cancelled');
            release();
            await wait(50);
            expect((await c.poll(started.taskId!)).status).toBe('cancelled');
        });

        it('opens the circuit after repeated infrastructure failures', async () => {
            const c = new AgentClient({
                url, apiKey: 'k3y', maxRetries: 0,
                circuitBreaker: { minimumCalls: 3, slidingWindowSize: 4, failureThreshold: 50 },
            });
            for (let i = 0; i < 4; i++) await c.run('boom', {}).catch(() => undefined);
            expect(c.getCircuitState()).toBe('open');
            await expect(c.run('echo', {})).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
            c.resetCircuit();
            expect(c.getCircuitState()).toBe('closed');
        }, 20_000);
    });
});
