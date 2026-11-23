/**
 * SPEC-0044 on the direct tool path: a tool called by code or an MCP client, with no model, is another way to run a tool, and it must not be a
 * way around the requirement. The server has a digital identity and says for whom it acts; every call is attributed to it and signed by it.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { generateKeyPairSync } from 'node:crypto';
import { defineTool, z } from '../../tools/defineTool';
import { MemoryAuditSink } from '../../governance/audit';
import { ed25519AgentIdentities, selfAssertedIdentities, type AgentIdentityProvider } from '../../governance/agent-identity';
import { agentSignatureProblem } from '../../governance/agent-signature';
import type { ToolPolicy } from '../../governance/types';
import { createToolServer, type ToolServerOptions } from '../tool-server';

let ran = 0;
const echo = defineTool({ name: 'echo', description: '', readOnly: true, input: z.object({ text: z.string() }), execute: async ({ text }) => { ran++; return text; } });

async function connect(opts: ToolServerOptions) {
    const server = createToolServer(opts);
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: 'c', version: '0' });
    await client.connect(c);
    return { client, close: async () => { await client.close(); await server.close(); } };
}
const textOf = (r: unknown) => ((r as { content?: Array<{ text?: string }> }).content ?? []).map(x => x.text ?? '').join('');
const call = (client: Client) => client.callTool({ name: 'echo', arguments: { text: 'hi' } });
const alice = { userId: 'alice' };

beforeEach(() => { ran = 0; });

describe('createToolServer requires an identity by default', () => {
    it('a server with no identity does not run any call, and the reason says how to fix it', async () => {
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, auditSink: sink });
        try {
            const r = await call(client);
            expect(r.isError).toBe(true);
            expect(textOf(r)).toMatch(/no digital identity.*agentIdentity.*requireAgentIdentity: false/s);
            expect(ran).toBe(0);
            expect(sink.events[0]).toMatchObject({ decision: 'deny', agentIdentityMissing: true });
        } finally { await close(); }
    });

    it('an identity with no one to act for does not run either', async () => {
        const { client, close } = await connect({ name: 'srv', tools: [echo], agentIdentity: selfAssertedIdentities() });
        try {
            const r = await call(client);
            expect(textOf(r)).toMatch(/on whose behalf.*identity\.userId/);
            expect(ran).toBe(0);
        } finally { await close(); }
    });

    it('with both, it runs, and the audit attributes the call to the identity of the server (self-asserted, marked)', async () => {
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, agentIdentity: selfAssertedIdentities(), auditSink: sink });
        try {
            expect(textOf(await call(client))).toBe('hi');
            expect(sink.events[0]).toMatchObject({ decision: 'allow', principal: { agentId: 'srv', userId: 'alice' }, agentIdentity: { id: 'urn:agent:srv', assurance: 'self-asserted' } });
        } finally { await close(); }
    });

    it('the policy sees the identity in the principal', async () => {
        const seen: unknown[] = [];
        const policy: ToolPolicy = { decide: (p) => { seen.push(p.agentIdentity?.id); return { effect: 'allow' }; } };
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, agentIdentity: selfAssertedIdentities(), policy });
        try { await call(client); expect(seen).toEqual(['urn:agent:srv']); } finally { await close(); }
    });

    it('the identity is checked BEFORE authorize and policy: neither is even asked for a server with no identity', async () => {
        const authorize = jest.fn(() => true);
        const decide = jest.fn(() => ({ effect: 'allow' as const }));
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, authorize, policy: { decide } });
        try { await call(client); expect(authorize).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled(); } finally { await close(); }
    });

    it('the explicit opt-out lets it run, the audit says there was no identity, and the server warns once on stderr', async () => {
        const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], requireAgentIdentity: false, auditSink: sink });
        try {
            await call(client); await call(client);
            expect(ran).toBe(2);
            expect(sink.events.every(e => e.agentIdentityMissing === true && e.decision === 'allow')).toBe(true);
            expect(write.mock.calls.filter(c => /no digital identity/.test(String(c[0])))).toHaveLength(1);
        } finally { write.mockRestore(); await close(); }
    });

    it('a provider that fails or does not answer denies the call, even with the opt-out', async () => {
        for (const resolve of [(): never => { throw new Error('IAM down'); }, (): Promise<never> => new Promise<never>(() => undefined)]) {
            const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, requireAgentIdentity: false, agentIdentity: { resolve }, agentIdentityTimeoutMs: 30, agentIdentityCacheMs: 0 });
            try { expect((await call(client)).isError).toBe(true); expect(ran).toBe(0); } finally { await close(); }
        }
    });
});

describe('the events of the direct tool path are signed by the identity of the server', () => {
    const key = generateKeyPairSync('ed25519').privateKey;
    const provider = () => ed25519AgentIdentities({ srv: { id: 'did:ex:srv', privateKey: key } });

    it('each call, allowed or denied, is signed, and verifies with the public key', async () => {
        const p = provider();
        const sink = new MemoryAuditSink();
        const policy: ToolPolicy = { decide: (_p, c) => (c.args.text === 'no' ? { effect: 'deny', reason: 'nope' } : { effect: 'allow' }) };
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, agentIdentity: p, policy, auditSink: sink });
        try {
            await call(client);
            await client.callTool({ name: 'echo', arguments: { text: 'no' } });
            expect(sink.events.map(e => e.decision)).toEqual(['allow', 'deny']);
            for (const e of sink.events) expect(agentSignatureProblem(e, { keyOf: (kid) => p.publicKeyOf(kid) })).toBeUndefined();
        } finally { await close(); }
    });

    it('a denial for lack of identity is recorded too, marked as such, and not as unsigned', async () => {
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], auditSink: sink });   // no identity at all
        try {
            await call(client);
            expect(agentSignatureProblem(sink.events[0]!, {})).toBeUndefined();   // "had no identity" is a declared state, not a missing signature
        } finally { await close(); }
    });

    it('a custody that cannot sign does not lose the record: written, marked, and a verifier never accepts it', async () => {
        const cannot: AgentIdentityProvider = { resolve: () => ({ id: 'did:ex:srv', kid: 'k' }), sign: () => { throw new Error('custody down'); } };
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, agentIdentity: cannot, auditSink: sink });
        try {
            expect(textOf(await call(client))).toBe('hi');
            expect(sink.events[0]).toMatchObject({ decision: 'allow', agentSignatureFailed: true });
            expect(agentSignatureProblem(sink.events[0]!, { allowUnsigned: true })).toMatch(/could not sign/);
        } finally { await close(); }
    });

    it('signAuditEvents: false records only the identity', async () => {
        const p = provider();
        const sink = new MemoryAuditSink();
        const { client, close } = await connect({ name: 'srv', tools: [echo], identity: alice, agentIdentity: p, signAuditEvents: false, auditSink: sink });
        try {
            await call(client);
            expect(sink.events[0]!.agentSignature).toBeUndefined();
            expect(sink.events[0]!.agentIdentity).toMatchObject({ id: 'did:ex:srv' });
        } finally { await close(); }
    });
});
