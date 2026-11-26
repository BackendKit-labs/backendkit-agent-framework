import * as net from 'node:net';
import { AgentServer } from '../index';
import type { ApprovalHandler } from '../server/ApprovalHandler';
import type { ControlHandler } from '../server/ControlHandler';
import type { FlowHandler } from '../server/FlowHandler';

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

const control: ControlHandler = {
    actions: ['pause'],
    control: async (a) => ({ did: a }),
    runs: async () => [{ runId: 'r1', status: 'running', startedAt: '2026-01-01T00:00:00Z' }],
    audit: async () => [],
};
const approvals = {
    list: async () => [],
    get: async (id: string) => ({ id }),
    decide: async (id: string) => ({ id }),
} as unknown as ApprovalHandler;
const flows = {
    flows: () => [],
    start: async () => ({ flowRunId: 'f1' }),
    status: async () => ({}),
    pause: async () => ({}),
    resume: async () => ({}),
    cancel: async () => ({}),
} as unknown as FlowHandler;

const running: AgentServer[] = [];
async function start(apiKey?: string): Promise<{ server: AgentServer; url: string }> {
    const port = await freePort();
    const server = new AgentServer({
        name: 'k', version: '1.0.0', description: 'd', port, allowUngated: true,
        ...(apiKey ? { apiKey } : {}), controlApiKey: 'control-key', control, approvalHandler: approvals, flowHandler: flows,
    });
    await server.start();
    running.push(server);
    return { server, url: `http://127.0.0.1:${port}` };
}
afterAll(async () => { await Promise.all(running.map(s => s.stop())); });

/** The control routes, as a client may spell them: the router ignores case and a trailing slash, and decodes %xx. */
const CONTROL_ROUTES: Array<[string, string, unknown?]> = [
    ['POST', '/v1/agent/control', { action: 'pause' }],
    ['GET', '/v1/agent/runs'],
    ['GET', '/v1/agent/audit'],
    ['GET', '/v1/agent/approvals'],
    ['GET', '/v1/agent/approvals/a1'],
    ['POST', '/v1/agent/approvals/a1/decision', { decision: 'approve' }],
    ['POST', '/v1/agent/flow-runs/f1/pause', {}],
];
const spellings = (path: string): string[] => [
    path,
    `${path}/`,
    path.toUpperCase(),
    path.replace('/v1/agent/', '/V1/Agent/'),
    path.replace('agent', '%61gent'),
];

describe('a control route needs the control key, however its URL is spelled', () => {
    for (const apiKey of ['run-key', undefined]) {
        it(`refuses every spelling without the control key (${apiKey ? 'run key presented' : 'no apiKey configured'})`, async () => {
            const { url } = await start(apiKey);
            for (const [method, path, body] of CONTROL_ROUTES) {
                for (const spelled of spellings(path)) {
                    const res = await fetch(`${url}${spelled}`, {
                        method,
                        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
                        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                    });
                    // 401 when the route matched and the key was wrong; 404 when the spelling matched no route. Never 2xx.
                    expect({ method, spelled, ok: res.ok }).toEqual({ method, spelled, ok: false });
                }
            }
        });
    }

    it('still opens the control routes with the control key', async () => {
        const { url } = await start('run-key');
        for (const [method, path, body] of CONTROL_ROUTES) {
            const res = await fetch(`${url}${path}`, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer control-key' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
            expect({ method, path, status: res.status }).toEqual({ method, path, status: 200 });
        }
    });
});

describe('every route declares the key that opens it', () => {
    it('only health is open; each other route starts with runKey or controlKey', async () => {
        const { server } = await start('run-key');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stack = (server as any).app._router.stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
        const routes = stack.filter(l => l.route).map(l => l.route!);
        expect(routes.length).toBeGreaterThan(10);
        for (const route of routes) {
            if (route.path === '/v1/agent/health') continue;
            const first = route.stack[0]?.handle;
            // A new route without its key is the bug this guards against: add `this.runKey` or `this.controlKey` to it.
            expect({ path: route.path, guarded: first === server.runKey || first === server.controlKey }).toEqual({ path: route.path, guarded: true });
        }
    });
});

describe('on loopback with no apiKey, only loopback callers are served', () => {
    it('refuses a foreign Host (a rebinding DNS name) and a foreign Origin (a web page)', async () => {
        const { url } = await start(undefined);
        const get = (headers: Record<string, string>) => fetch(`${url}/v1/agent/info`, { headers });
        expect((await get({})).status).toBe(200);                                         // a local client: loopback Host, no Origin
        expect((await get({ Origin: 'http://localhost:5173' })).status).toBe(200);       // a local page
        expect((await get({ Origin: 'https://evil.example' })).status).toBe(403);         // a foreign page
        // Node's fetch sets Host from the URL; a raw request shows what a rebinding name sends.
        const raw = await new Promise<number>((resolve, reject) => {
            const u = new URL(url);
            const req = require('node:http').request({ host: u.hostname, port: u.port, path: '/v1/agent/info', headers: { Host: 'rebind.evil.example' } },
                (res: { statusCode: number; resume(): void }) => { res.resume(); resolve(res.statusCode); });
            req.on('error', reject);
            req.end();
        });
        expect(raw).toBe(403);
    });

    it('with an apiKey the key is the check, whatever the Host', async () => {
        const { url } = await start('run-key');
        const res = await fetch(`${url}/v1/agent/info`, { headers: { Authorization: 'Bearer run-key', Origin: 'https://app.example' } });
        expect(res.status).toBe(200);
    });
});
