/**
 * SPEC-0044 on the capability server: a capability is another way to act, so a run starts only through a gate that says under which identity and for
 * whom. With no gate the server runs nothing, and a gate that fails never means "let it through".
 */
import * as net from 'node:net';
import { AgentServer, type CapabilityCall, type CapabilityDefinition, type CapabilityGate } from '../index';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
    });
}
const def = (name: string, async = false): CapabilityDefinition => ({ name, description: name, async, input: {}, output: { type: 'string' } } as unknown as CapabilityDefinition);

interface Env { code?: string; message?: string }
async function start(opts: { gate?: CapabilityGate; allowUngated?: boolean; apiKey?: string }) {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const ran: Array<{ capability: string; userId?: string; identity?: string }> = [];
    const server = new AgentServer({ name: 'a', version: '1.0.0', description: 'd', port, ...opts });
    server.register({ definition: def('work'), execute: async (_i, ctx) => { ran.push({ capability: 'work', ...(ctx.userId ? { userId: ctx.userId } : {}), ...(ctx.agentIdentity ? { identity: ctx.agentIdentity.id } : {}) }); return 'done'; } });
    server.register({ definition: def('boom'), execute: async () => { throw new Error('kaput'); } });
    server.register({ definition: def('later', true), execute: async (_i, ctx) => { ran.push({ capability: 'later', ...(ctx.userId ? { userId: ctx.userId } : {}) }); return 'ok'; } });
    await server.start();
    const post = async (capability: string, headers: Record<string, string> = {}) => {
        const res = await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ capability, input: { x: 1 } }) });
        return { status: res.status, body: (await res.json()) as { data?: { status: string; taskId?: string }; error?: Env } };
    };
    return { server, ran, post, url };
}

describe('a capability server needs a gate', () => {
    let current: AgentServer | undefined;
    afterEach(async () => { await current?.stop(); current = undefined; });

    it('with no gate it runs nothing, and the reason says how to fix it', async () => {
        const s = await start({}); current = s.server;
        const r = await s.post('work');
        expect(r.status).toBe(403);
        expect(r.body.error).toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/no identity gate.*capabilityIdentityGate.*allowUngated/s) });
        expect(s.ran).toEqual([]);
    });

    it('allowUngated is the explicit opt-out, for tests', async () => {
        const s = await start({ allowUngated: true }); current = s.server;
        expect((await s.post('work')).status).toBe(200);
        expect(s.ran).toHaveLength(1);
    });

    it('a gate that lets the run in can add who it acts for and under which identity: the handler receives it', async () => {
        const seen: CapabilityCall[] = [];
        const gate: CapabilityGate = (call) => { seen.push(call); return { ok: true, context: { userId: 'alice', agentIdentity: { id: 'did:ex:a' } } }; };
        const s = await start({ gate }); current = s.server;
        const r = await s.post('work', { 'x-tenant-id': 't1' });
        expect(r.body.data?.status).toBe('done');
        expect(s.ran).toEqual([{ capability: 'work', userId: 'alice', identity: 'did:ex:a' }]);
        expect(seen[0]).toMatchObject({ capability: 'work', input: { x: 1 }, context: { tenantId: 't1' }, headers: { 'x-tenant-id': 't1' } });
    });

    it('a gate that refuses stops the run before the handler, with the code it chose', async () => {
        const forbidden = await start({ gate: () => ({ ok: false, message: 'no identity' }) }); current = forbidden.server;
        const f = await forbidden.post('work');
        expect(f.status).toBe(403);
        expect(f.body.error).toMatchObject({ code: 'FORBIDDEN', message: 'no identity' });
        expect(forbidden.ran).toEqual([]);
        await forbidden.server.stop();
        const unauth = await start({ gate: () => ({ ok: false, code: 'UNAUTHORIZED', message: 'who are you' }) }); current = unauth.server;
        expect((await unauth.post('work')).status).toBe(401);
    });

    it('a gate that throws, or answers with something that is not an answer, refuses: it never means "let it through"', async () => {
        const throws = await start({ gate: () => { throw new Error('IAM down'); } }); current = throws.server;
        const t = await throws.post('work');
        expect(t.status).toBe(403);
        expect(t.body.error?.message).toMatch(/identity gate failed: Internal error/);   // why stays in the server's log
        expect(t.body.error?.message).not.toContain('IAM down');
        expect(throws.ran).toEqual([]);
        await throws.server.stop();
        const junk = await start({ gate: (() => undefined) as unknown as CapabilityGate }); current = junk.server;
        expect((await junk.post('work')).status).toBe(403);
        expect(junk.ran).toEqual([]);
    });

    it('the gate is told how each run ended, success or failure, and a failure inside finish changes nothing', async () => {
        const ended: Array<{ ok: boolean; error?: string }> = [];
        const gate: CapabilityGate = () => ({ ok: true, finish: (o) => { ended.push(o); throw new Error('sink down'); } });
        const s = await start({ gate }); current = s.server;
        expect((await s.post('work')).status).toBe(200);
        const failed = await s.post('boom');
        expect(failed.status).toBe(500);
        expect(failed.body.error?.message).not.toContain('kaput');                  // internal: the caller gets an errorId
        expect(ended).toEqual([{ ok: true }, { ok: false, error: 'kaput' }]);   // the gate, on the server, keeps the real one
    });

    it('an asynchronous run is gated too, and its context carries the identity', async () => {
        const s = await start({ gate: () => ({ ok: true, context: { userId: 'bob' } }) }); current = s.server;
        const r = await s.post('later');
        expect(r.body.data?.status).toBe('running');
        for (let i = 0; i < 50 && s.ran.length === 0; i++) await new Promise(res => setTimeout(res, 10));
        expect(s.ran).toEqual([{ capability: 'later', userId: 'bob' }]);
    });

    it('the gate cannot be skipped by asking for another route: an unknown capability is still 404 and gets no gate', async () => {
        const gate = jest.fn((): { ok: true } => ({ ok: true }));
        const s = await start({ gate }); current = s.server;
        expect((await s.post('nope')).status).toBe(404);
        expect(gate).not.toHaveBeenCalled();
    });
});

describe('the start of a flow is gated like a capability', () => {
    it('with no gate it does not start; with a gate that adds the user, the flow handler receives it', async () => {
        const started: Array<{ flow: string; userId?: string }> = [];
        const flowHandler = {
            flows: () => [{ name: 'f', description: 'd' }] as never,
            start: async (flow: string, _i: Record<string, unknown>, ctx: { userId?: string }) => { started.push({ flow, ...(ctx.userId ? { userId: ctx.userId } : {}) }); return { flowRunId: 'r1' }; },
            status: async () => ({}) as never, pause: async () => ({}) as never, resume: async () => ({}) as never, cancel: async () => ({}) as never,
        };
        const post = (url: string) => fetch(`${url}/v1/agent/flows/f/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: {} }) });
        const close: AgentServer[] = [];
        try {
            const p1 = await freePort();
            const noGate = new AgentServer({ name: 'a', version: '1', description: 'd', port: p1, flowHandler }); close.push(noGate); await noGate.start();
            expect((await post(`http://127.0.0.1:${p1}`)).status).toBe(403);
            expect(started).toEqual([]);
            const p2 = await freePort();
            const gated = new AgentServer({ name: 'a', version: '1', description: 'd', port: p2, flowHandler, gate: (c) => ({ ok: true, context: { userId: c.capability === 'flow:f' ? 'carol' : 'x' } }) }); close.push(gated); await gated.start();
            expect((await post(`http://127.0.0.1:${p2}`)).status).toBe(200);
            expect(started).toEqual([{ flow: 'f', userId: 'carol' }]);
        } finally { for (const c of close) await c.stop(); }
    });
});
