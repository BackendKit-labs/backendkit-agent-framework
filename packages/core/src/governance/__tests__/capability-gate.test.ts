/**
 * SPEC-0044 on the capability server of agent-protocol: `capabilityIdentityGate` gives an AgentServer the same rule as the engine (an identity for
 * the agent and a person to act for, or nothing runs) and leaves a signed, attributed audit event per run. Tested against a real AgentServer.
 */
import * as net from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { AgentServer, type CapabilityDefinition } from '@backendkit-labs/agent-protocol';
import { MemoryAuditSink } from '../audit';
import { capabilityIdentityGate, type CapabilityIdentityGateOptions } from '../capability-gate';
import { ed25519AgentIdentities, selfAssertedIdentities, type AgentIdentityProvider } from '../agent-identity';
import { agentSignatureProblem } from '../agent-signature';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
    });
}
const def = (name: string): CapabilityDefinition => ({ name, description: name, async: false, input: {}, output: { type: 'string' } } as unknown as CapabilityDefinition);

describe('capabilityIdentityGate on a real AgentServer', () => {
    let server: AgentServer | undefined;
    afterEach(async () => { await server?.stop(); server = undefined; });

    async function start(gateOpts: Partial<CapabilityIdentityGateOptions>) {
        const sink = new MemoryAuditSink();
        const port = await freePort();
        const seen: Array<{ userId?: string; identity?: string }> = [];
        server = new AgentServer({ name: 'svc', version: '1', description: 'd', port, gate: capabilityIdentityGate({ name: 'svc', auditSink: sink, ...gateOpts }) });
        server.register({ definition: def('work'), execute: async (_i, ctx) => { seen.push({ ...(ctx.userId ? { userId: ctx.userId } : {}), ...(ctx.agentIdentity ? { identity: ctx.agentIdentity.id } : {}) }); return 'done'; } });
        server.register({ definition: def('boom'), execute: async () => { throw new Error('kaput'); } });
        await server.start();
        const post = async (capability: string, headers: Record<string, string> = {}) => {
            const res = await fetch(`http://127.0.0.1:${port}/v1/agent/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ capability, input: { n: 1 } }) });
            return { status: res.status, body: (await res.json()) as { data?: { status: string }; error?: { code: string; message: string } } };
        };
        return { sink, seen, post };
    }

    it('with no identity for the agent nothing runs, the reason says how to fix it and the audit records the refusal', async () => {
        const { sink, seen, post } = await start({ identity: { userId: 'alice' } });
        const r = await post('work');
        expect(r.status).toBe(403);
        expect(r.body.error?.message).toMatch(/no digital identity.*agentIdentity/s);
        expect(seen).toEqual([]);
        expect(sink.events[0]).toMatchObject({ tool: 'work', decision: 'deny', agentIdentityMissing: true });
    });

    it('an identity with no one to act for does not run either', async () => {
        const { seen, post } = await start({ agentIdentity: selfAssertedIdentities() });
        const r = await post('work');
        expect(r.status).toBe(403);
        expect(r.body.error?.message).toMatch(/on whose behalf/);
        expect(seen).toEqual([]);
    });

    it('with both, it runs: the handler receives the user and the identity, and the audit event is attributed', async () => {
        const { sink, seen, post } = await start({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'alice' } });
        expect((await post('work')).body.data?.status).toBe('done');
        expect(seen).toEqual([{ userId: 'alice', identity: 'urn:agent:svc' }]);
        expect(sink.events[0]).toMatchObject({ tool: 'work', decision: 'allow', outcome: 'ok', principal: { agentId: 'svc', userId: 'alice' }, agentIdentity: { id: 'urn:agent:svc', assurance: 'self-asserted' } });
    });

    it('who the run is for can come from the call: a function of what the operator verified, and no user means no run', async () => {
        const { seen, post } = await start({ agentIdentity: selfAssertedIdentities(), identity: (call) => { const u = call.headers['x-verified-user']; return typeof u === 'string' ? { userId: u } : undefined; } });
        expect((await post('work', { 'x-verified-user': 'bob' })).status).toBe(200);
        expect(seen).toEqual([{ userId: 'bob', identity: 'urn:agent:svc' }]);
        expect((await post('work')).status).toBe(403);
        expect(seen).toHaveLength(1);
    });

    it('a function that cannot establish the caller refuses, it does not guess', async () => {
        const { sink, seen, post } = await start({ agentIdentity: selfAssertedIdentities(), identity: () => { throw new Error('token invalid'); } });
        const r = await post('work');
        expect(r.status).toBe(403);
        expect(r.body.error?.message).toMatch(/could not be established: token invalid/);
        expect(seen).toEqual([]);
        expect(sink.events[0]).toMatchObject({ decision: 'deny' });
    });

    it('the x-tenant-id header the caller sets is not taken as who the run is for', async () => {
        const { sink, post } = await start({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'alice' } });
        await post('work', { 'x-tenant-id': 'evil-corp' });
        expect(sink.events[0]!.principal.tenantId).toBeUndefined();
    });

    it('a handler that fails is recorded as an error with its message, and the answer is the usual 500', async () => {
        const { sink, post } = await start({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'alice' } });
        const r = await post('boom');
        expect(r.status).toBe(500);
        expect(sink.events[0]).toMatchObject({ tool: 'boom', decision: 'allow', outcome: 'error', reason: 'kaput' });
    });

    it('the explicit opt-out lets the run through and the audit says there was no identity', async () => {
        const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const { sink, post } = await start({ requireAgentIdentity: false });
            expect((await post('work')).status).toBe(200);
            expect(sink.events[0]).toMatchObject({ decision: 'allow', agentIdentityMissing: true });
        } finally { write.mockRestore(); }
    });

    it('a provider that fails denies the run, even with the opt-out', async () => {
        const broken: AgentIdentityProvider = { resolve: () => { throw new Error('IAM down'); } };
        const { seen, post } = await start({ agentIdentity: broken, identity: { userId: 'alice' }, requireAgentIdentity: false, agentIdentityCacheMs: 0 });
        expect((await post('work')).status).toBe(403);
        expect(seen).toEqual([]);
    });

    describe('signed events', () => {
        it('each run, allowed or refused, is signed by the identity of the agent and verifies with the public key', async () => {
            const provider = ed25519AgentIdentities({ svc: { id: 'did:ex:svc', privateKey: generateKeyPairSync('ed25519').privateKey } });
            const { sink, post } = await start({ agentIdentity: provider, identity: (call) => (call.headers['x-user'] ? { userId: String(call.headers['x-user']) } : undefined) });
            await post('work', { 'x-user': 'alice' });
            await post('work');
            expect(sink.events.map(e => e.decision)).toEqual(['allow', 'deny']);
            for (const e of sink.events) expect(agentSignatureProblem(e, { keyOf: (kid) => provider.publicKeyOf(kid) })).toBeUndefined();
        });

        it('a custody that cannot sign does not lose the record: written, marked, never accepted as signed', async () => {
            const cannot: AgentIdentityProvider = { resolve: () => ({ id: 'did:ex:svc', kid: 'k' }), sign: () => { throw new Error('custody down'); } };
            const { sink, post } = await start({ agentIdentity: cannot, identity: { userId: 'alice' } });
            expect((await post('work')).status).toBe(200);
            expect(sink.events[0]).toMatchObject({ decision: 'allow', agentSignatureFailed: true });
            expect(agentSignatureProblem(sink.events[0]!, { allowUnsigned: true })).toMatch(/could not sign/);
        });
    });
});
