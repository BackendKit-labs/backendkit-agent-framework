import * as net from 'node:net';
import { AgentServer, AgentClient, ControlError, CircuitBreakerState } from '../index';
import type { AuditQuery, CapabilityDefinition, ControlAction, ControlHandler } from '../index';

const def = (name: string, async = false): CapabilityDefinition => ({ name, description: name, async, input: {}, output: {} });

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
const auth = (key?: string): Record<string, string> => ({ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

interface Started { server: AgentServer; url: string }
const running: AgentServer[] = [];
async function start(opts: Partial<ConstructorParameters<typeof AgentServer>[0]> = {}): Promise<Started> {
    const port = await freePort();
    const server = new AgentServer({ allowUngated: true, name: 'ctl', version: '1.0.0', description: 'd', port, ...opts });
    server.register({ definition: def('echo'), execute: async input => input });
    server.register({ definition: def('long', true), execute: async () => 'done' });
    server.register({ definition: def('boom'), execute: async () => { throw new Error('kaput'); } });
    await server.start();
    running.push(server);
    return { server, url: `http://127.0.0.1:${port}` };
}
afterAll(async () => { await Promise.all(running.map(s => s.stop())); });

const post = (url: string, key: string | undefined, body: unknown) =>
    fetch(`${url}/v1/agent/control`, { method: 'POST', headers: auth(key), body: JSON.stringify(body) });

describe('control surface is closed unless explicitly opened', () => {
    it('without controlApiKey every control endpoint answers FORBIDDEN, even for the run key', async () => {
        const { url } = await start({ apiKey: 'run-key' });
        for (const [method, path] of [['POST', '/v1/agent/control'], ['GET', '/v1/agent/runs'], ['GET', '/v1/agent/audit']] as const) {
            const res = await fetch(`${url}${path}`, { method, headers: auth('run-key'), ...(method === 'POST' ? { body: '{"action":"drain"}' } : {}) });
            expect(res.status).toBe(403);
            expect((await json(res)).error.code).toBe('FORBIDDEN');
        }
    });

    it('the run key does not open control, and the control key does not open run', async () => {
        const { url } = await start({ apiKey: 'run-key', controlApiKey: 'ctl-key' });
        expect((await post(url, 'run-key', { action: 'drain' })).status).toBe(401);
        expect((await post(url, undefined, { action: 'drain' })).status).toBe(401);
        const run = await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: auth('ctl-key'), body: '{"capability":"echo","input":{}}' });
        expect(run.status).toBe(401);
        expect((await post(url, 'ctl-key', { action: 'drain' })).status).toBe(200);
    });

    it('an open server (no run key) still needs the control key', async () => {
        const { url } = await start({ controlApiKey: 'ctl-key' });
        expect((await fetch(`${url}/v1/agent/runs`)).status).toBe(401);
        expect((await fetch(`${url}/v1/agent/runs`, { headers: auth('ctl-key') })).status).toBe(200);
    });
});

describe('protocol 1.0 behaviour is unchanged', () => {
    it('info publishes the minor, and lists control actions only when control is enabled', async () => {
        const off = await start();
        expect((await json(await fetch(`${off.url}/v1/agent/info`))).data).toMatchObject({ protocolMinor: 2 });
        expect((await json(await fetch(`${off.url}/v1/agent/info`))).data.control).toBeUndefined();

        const on = await start({ controlApiKey: 'c', limits: { maxConcurrent: 2 }, flows: [{ name: 'close-month', steps: ['a', 'b'] }] });
        expect((await json(await fetch(`${on.url}/v1/agent/info`))).data).toMatchObject({
            protocolMinor: 2, control: ['drain', 'resume'], limits: { maxConcurrent: 2 }, flows: [{ name: 'close-month' }],
        });
    });

    it('runs work as before on a server with no control configured', async () => {
        const { url } = await start();
        const res = await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: auth(), body: '{"capability":"echo","input":{"a":1}}' });
        expect((await json(res)).data).toMatchObject({ status: 'done', output: { a: 1 } });
    });
});

describe('drain and resume (the server\'s own)', () => {
    it('drain refuses new runs with AGENT_UNAVAILABLE, keeps health up, and resume reopens', async () => {
        const { url } = await start({ controlApiKey: 'c' });
        const run = () => fetch(`${url}/v1/agent/run`, { method: 'POST', headers: auth(), body: '{"capability":"echo","input":{}}' });

        expect((await json(await post(url, 'c', { action: 'drain' }))).data).toMatchObject({ action: 'drain', draining: true });
        const refused = await run();
        expect(refused.status).toBe(503);
        expect((await json(refused)).error.code).toBe('AGENT_UNAVAILABLE');
        expect((await fetch(`${url}/v1/agent/health`)).status).toBe(200);
        expect((await json(await fetch(`${url}/v1/agent/runs`, { headers: auth('c') }))).data.draining).toBe(true);

        expect((await json(await post(url, 'c', { action: 'resume' }))).data).toMatchObject({ draining: false });
        expect((await run()).status).toBe(200);
    });

    it('an unknown capability is still reported as such while draining is off, and wins over draining when asked', async () => {
        const { url } = await start({ controlApiKey: 'c' });
        await post(url, 'c', { action: 'drain' });
        const res = await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: auth(), body: '{"capability":"ghost","input":{}}' });
        expect((await json(res)).error.code).toBe('CAPABILITY_NOT_FOUND');
    });
});

describe('control actions go to the handler', () => {
    function handler(over: Partial<ControlHandler> = {}) {
        const calls: Array<{ action: ControlAction; params: Record<string, unknown>; tenant?: string }> = [];
        const h: ControlHandler = {
            actions: ['get_sandbox_policy', 'set_sandbox_policy', 'list_jobs', 'cancel_job', 'resume'],
            async control(action, params, ctx) {
                calls.push({ action, params, tenant: ctx.tenantId });
                if (action === 'set_sandbox_policy' && params.mode === 'danger-full-access') {
                    throw new ControlError('POLICY_WIDER_THAN_PARENT', 'mode: child danger-full-access vs parent read-only', { dimension: 'mode' });
                }
                if (action === 'cancel_job' && params.id === 'boom') throw new Error('registry exploded');
                return action === 'get_sandbox_policy' ? { preset: 'read-only', version: 3 } : { ok: true };
            },
            ...over,
        };
        return { h, calls };
    }

    it('dispatches an action with its params and context, and returns the handler result', async () => {
        const { h, calls } = handler();
        const { url } = await start({ controlApiKey: 'c', control: h });
        const res = await fetch(`${url}/v1/agent/control`, { method: 'POST', headers: { ...auth('c'), 'X-Tenant-ID': 'acme' }, body: JSON.stringify({ action: 'get_sandbox_policy' }) });
        expect((await json(res)).data).toEqual({ action: 'get_sandbox_policy', result: { preset: 'read-only', version: 3 } });
        expect(calls).toEqual([{ action: 'get_sandbox_policy', params: {}, tenant: 'acme' }]);

        await post(url, 'c', { action: 'cancel_job', params: { id: 'bash-1' } });
        expect(calls[1]).toMatchObject({ action: 'cancel_job', params: { id: 'bash-1' } });
    });

    it('info advertises the handler actions plus drain and resume', async () => {
        const { url } = await start({ controlApiKey: 'c', control: handler().h });
        const info = (await json(await fetch(`${url}/v1/agent/info`))).data;
        expect(info.control.sort()).toEqual(['cancel_job', 'drain', 'get_sandbox_policy', 'list_jobs', 'resume', 'set_sandbox_policy']);
    });

    it('a ControlError keeps its protocol code and status; any other error is EXECUTION_FAILED', async () => {
        const { url } = await start({ controlApiKey: 'c', control: handler().h });
        const wider = await post(url, 'c', { action: 'set_sandbox_policy', params: { mode: 'danger-full-access' } });
        expect(wider.status).toBe(403);
        expect((await json(wider)).error).toMatchObject({ code: 'POLICY_WIDER_THAN_PARENT', details: { dimension: 'mode' } });

        const broken = await post(url, 'c', { action: 'cancel_job', params: { id: 'boom' } });
        expect(broken.status).toBe(500);
        expect((await json(broken)).error).toMatchObject({ code: 'EXECUTION_FAILED', message: 'registry exploded' });
    });

    it('an error from another package is recognised by name and code, without importing ControlError', async () => {
        class ForeignControlError extends Error {
            readonly code = 'APPROVAL_REQUIRED';
            readonly details = { why: 'no approver' };
            constructor() { super('widening needs approval'); this.name = 'ControlError'; }
        }
        const { url } = await start({ controlApiKey: 'c', control: { actions: ['set_sandbox_policy'], control: async () => { throw new ForeignControlError(); } } });
        const res = await post(url, 'c', { action: 'set_sandbox_policy', params: {} });
        expect(res.status).toBe(403);
        expect((await json(res)).error).toMatchObject({ code: 'APPROVAL_REQUIRED', message: 'widening needs approval', details: { why: 'no approver' } });
    });

    it('an action the handler does not implement answers CONTROL_UNSUPPORTED (501)', async () => {
        const { url } = await start({ controlApiKey: 'c', control: { actions: ['list_jobs'], control: async () => [] } });
        const res = await post(url, 'c', { action: 'set_budget', params: { usd: 1 } });
        expect(res.status).toBe(501);
        expect((await json(res)).error.code).toBe('CONTROL_UNSUPPORTED');
    });

    it.each([
        ['an unknown action', { action: 'format_disk' }],
        ['a missing action', {}],
        ['params that are not an object', { action: 'drain', params: [1] }],
    ])('rejects %s with INVALID_INPUT and calls nothing', async (_l, body) => {
        const { h, calls } = handler();
        const { url } = await start({ controlApiKey: 'c', control: h });
        const res = await post(url, 'c', body);
        expect(res.status).toBe(400);
        expect((await json(res)).error.code).toBe('INVALID_INPUT');
        expect(calls).toHaveLength(0);
    });

    it('resume also reaches a handler that implements it (un-pause) and clears draining', async () => {
        const { h, calls } = handler();
        const { url } = await start({ controlApiKey: 'c', control: h });
        await post(url, 'c', { action: 'drain' });
        await post(url, 'c', { action: 'resume' });
        expect(calls.map(c => c.action)).toEqual(['resume']);
        expect((await json(await fetch(`${url}/v1/agent/runs`, { headers: auth('c') }))).data.draining).toBe(false);
    });
});

describe('runs and audit', () => {
    it('lists runs from the task store, with their capability', async () => {
        const { url } = await start({ controlApiKey: 'c' });
        const started = await json(await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: auth(), body: '{"capability":"long","input":{},"async":true}' }));
        const { runs } = (await json(await fetch(`${url}/v1/agent/runs`, { headers: auth('c') }))).data;
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ runId: started.data.taskId, capability: 'long' });
    });

    it('a handler can provide its own run list', async () => {
        const { url } = await start({ controlApiKey: 'c', control: { actions: [], control: async () => null, runs: async () => [{ runId: 'r1', status: 'running', startedAt: '2026-10-23T00:00:00Z' }] } });
        expect((await json(await fetch(`${url}/v1/agent/runs`, { headers: auth('c') }))).data.runs).toEqual([{ runId: 'r1', status: 'running', startedAt: '2026-10-23T00:00:00Z' }]);
    });

    it('audit passes since and limit to the handler, and validates them', async () => {
        const seen: AuditQuery[] = [];
        const control: ControlHandler = {
            actions: [], control: async () => null,
            audit: async q => { seen.push(q); return [{ ts: '2026-10-23T10:00:00Z', tool: 'sandbox:write_file', outcome: 'SANDBOX_DENIED' }]; },
        };
        const { url } = await start({ controlApiKey: 'c', control });
        const ok = await fetch(`${url}/v1/agent/audit?since=2026-10-23T00:00:00Z&limit=50`, { headers: auth('c') });
        expect((await json(ok)).data.entries[0]).toMatchObject({ outcome: 'SANDBOX_DENIED' });
        expect(seen).toEqual([{ since: '2026-10-23T00:00:00Z', limit: 50 }]);

        for (const q of ['limit=0', 'limit=abc', 'limit=99999', 'since=yesterday']) {
            const bad = await fetch(`${url}/v1/agent/audit?${q}`, { headers: auth('c') });
            expect(bad.status).toBe(400);
        }
        expect(seen).toHaveLength(1);
    });

    it('without an audit provider the endpoint answers CONTROL_UNSUPPORTED', async () => {
        const { url } = await start({ controlApiKey: 'c' });
        const res = await fetch(`${url}/v1/agent/audit`, { headers: auth('c') });
        expect(res.status).toBe(501);
        expect((await json(res)).error.code).toBe('CONTROL_UNSUPPORTED');
    });
});

describe('AgentClient control calls', () => {
    it('control(), listRuns() and audit() work with the control key and carry the protocol code on errors', async () => {
        const control: ControlHandler = {
            actions: ['set_sandbox_policy'],
            control: async () => { throw new ControlError('APPROVAL_REQUIRED', 'widening needs approval'); },
            audit: async () => [{ ts: '2026-10-23T10:00:00Z', outcome: 'allowed' }],
        };
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl', control });
        const client = new AgentClient({ url, apiKey: 'run', controlApiKey: 'ctl', maxRetries: 0 });

        expect(await client.audit({ limit: 5 })).toEqual([{ ts: '2026-10-23T10:00:00Z', outcome: 'allowed' }]);
        expect((await client.listRuns()).draining).toBe(false);
        await expect(client.control('set_sandbox_policy', { preset: 'full' })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED', status: 403 });
        expect(await client.control('drain')).toMatchObject({ draining: true });
    });

    it('a client without a control key refuses to call control, and never reuses the run key', async () => {
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        const client = new AgentClient({ url, apiKey: 'run' });
        await expect(client.control('drain')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('control still works while the run circuit is open', async () => {
        const { url } = await start({ controlApiKey: 'ctl' });
        const client = new AgentClient({
            url, controlApiKey: 'ctl', maxRetries: 0,
            circuitBreaker: { minimumCalls: 1, slidingWindowSize: 1, failureThreshold: 1, openTimeoutMs: 60_000 },
        });
        await expect(client.run('boom', {})).rejects.toBeDefined();
        expect(client.getCircuitState()).toBe(CircuitBreakerState.OPEN);
        await expect(client.run('echo', {})).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
        expect(await client.control('drain')).toMatchObject({ draining: true });
    });

    it('a control call that does not answer in time fails with TIMEOUT', async () => {
        const control: ControlHandler = { actions: ['list_jobs'], control: () => new Promise(() => undefined) };
        const { url } = await start({ controlApiKey: 'ctl', control });
        const client = new AgentClient({ url, controlApiKey: 'ctl', timeout: 200 });
        await expect(client.control('list_jobs')).rejects.toMatchObject({ code: 'TIMEOUT' });
    });
});
