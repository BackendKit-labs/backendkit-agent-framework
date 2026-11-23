/**
 * SPEC-0044 F3 with the reference verifier: the whole chain person → issuer → key of the agent → proof at the call. A credential tied to a key
 * (`cnf`) is accepted when the agent proves it holds it and refused when it does not; a bearer one is marked `none`. Run with a real engine and
 * the identity provider of the engine, so the proof is the one `core` signs with.
 */
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { createBaseEngine, ed25519AgentIdentities, mandatePolicy, MemoryAuditSink, type AgentProfile, type ToolDefinition } from '@backendkit-labs/agent-core';
import { jwtMandateVerifier, issueMandate } from '../index';

const company = generateKeyPairSync('ed25519');
const agentKey = generateKeyPairSync('ed25519');
const thief = generateKeyPairSync('ed25519');
const identities = ed25519AgentIdentities({ buyer: { id: 'did:ex:buyer', privateKey: agentKey.privateKey } });
const trusted = { 'did:example:company': company.publicKey };
const agent: AgentProfile = { id: 'buyer', name: 'Buyer', icon: '🛒', description: 'x', systemPrompt: 'Buy.', allowedTools: ['buy'] };

const credential = (over: Record<string, unknown> = {}) => issueMandate({
    privateKey: company.privateKey, alg: 'EdDSA', issuer: 'did:example:company', subject: 'carlos', id: 'm-1', agent: 'buyer', agentIdentity: 'did:ex:buyer',
    holderKey: agentKey.publicKey, actions: ['buy'], limits: { amount: { max: 1000, currency: 'EUR' } },
    notBefore: Math.floor(Date.now() / 1000) - 60, expiresAt: Math.floor(Date.now() / 1000) + 3600, ...over,
});

type Signer = { sign?: (agentId: string, message: Uint8Array, context: never) => unknown };

/** One run of the agent. `policyIdentity` is what the POLICY can sign with (the proof); `engineIdentity` is who the engine says the agent is. */
async function run(c: string, policyIdentity: Signer | undefined, extra: Record<string, unknown> = {}, engineIdentity: unknown = identities) {
    const bought: unknown[] = [];
    const buy = { name: 'buy', description: 'buy', parameters: {}, destructive: true, execute: async (a: unknown) => { bought.push(a); return 'bought'; } } as ToolDefinition;
    const audit = new MemoryAuditSink();
    const calls = [{ tool_calls: [{ id: 'c', name: 'buy', args: { amount: 10, currency: 'EUR' } }] }, { content: 'done' }];
    let i = 0;
    const provider = { chat: async (_m: unknown, _t: unknown, cb: any) => {
        const turn = calls[Math.min(i++, calls.length - 1)] as any;
        if (turn.tool_calls) { for (const t of turn.tool_calls) cb.onToolCall?.(t.name, JSON.stringify(t.args), t.id); cb.onDone({ role: 'assistant', content: null, tool_calls: turn.tool_calls.map((t: any) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) }); }
        else { cb.onChunk?.(turn.content); cb.onDone({ role: 'assistant', content: turn.content }); }
    } };
    const engine = createBaseEngine({
        providers: { mock: provider as never }, defaultProvider: 'mock', agents: [agent], defaultAgent: 'buyer', tools: [buy],
        transport: { emit: () => undefined } as never, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
        agentIdentity: engineIdentity as never,
        policy: mandatePolicy({
            verifier: jwtMandateVerifier({ trustedIssuers: trusted, credentialFor: () => c }),
            amountOf: a => ({ value: Number((a as { amount: number }).amount), currency: 'EUR' }),
            ...(policyIdentity ? { agentIdentity: policyIdentity as never } : {}), ...extra,
        }),
    } as never);
    await engine.run('buy it');
    return { bought, event: audit.events.find(e => e.tool === 'buy')! };
}

describe('a credential tied to the key of the agent', () => {
    it('is accepted when the agent proves it holds the key, and the audit says proven and for which identity', async () => {
        const { bought, event } = await run(credential(), identities);
        expect(bought).toHaveLength(1);
        expect(event.mandate).toMatchObject({ agentIdentity: 'did:ex:buyer', holderBinding: 'proven', subject: 'carlos' });
    });
    it('is refused when the agent signs with a key that is not the one of the credential (a stolen credential)', async () => {
        const stolen: Signer = { sign: (_a, m) => ({ kid: 'thief', signature: edSign(null, Buffer.from(m), thief.privateKey).toString('base64url') }) };
        const { bought, event } = await run(credential(), stolen);
        expect(bought).toHaveLength(0);
        expect(event).toMatchObject({ decision: 'deny' });
        expect(event.reason).toMatch(/prove possession.*signed by the key/s);
    });
    it('is refused when the policy has no way to ask the agent for a proof', async () => {
        const { bought, event } = await run(credential(), undefined);
        expect(bought).toHaveLength(0);
        expect(event.reason).toMatch(/no way to prove/);
    });
    it('is refused when the provider fails to sign', async () => {
        const down: Signer = { sign: () => { throw new Error('custody down'); } };
        const { bought, event } = await run(credential(), down);
        expect(bought).toHaveLength(0);
        expect(event.reason).toMatch(/custody down/);
    });
    it('is refused for another agent identity even with a valid proof: the credential names who it is for', async () => {
        const other = ed25519AgentIdentities({ buyer: { id: 'did:ex:OTHER', privateKey: agentKey.privateKey } });
        const { bought, event } = await run(credential(), other, {}, other);
        expect(bought).toHaveLength(0);
        expect(event.reason).toMatch(/another agent identity/);
    });
    it('a proof made for one verifier is not valid for another: the audience and the nonce are part of what is signed', async () => {
        const recorded: Uint8Array[] = [];
        const spy: Signer = { sign: (a, m, c) => { recorded.push(m); return (identities as unknown as Required<Signer>).sign(a, m, c); } };
        await run(credential(), spy);
        const replayed = recorded[0]!;
        const principal = { agentId: 'buyer', sessionId: 's', chain: ['buyer'], userId: 'carlos', agentIdentity: { id: 'did:ex:buyer' } };
        const verdict = await jwtMandateVerifier({ trustedIssuers: trusted, credentialFor: () => credential(), audience: 'urn:other' }).verify({
            principal, call: { tool: { name: 'buy' } as never, args: {} },
            prove: async () => ({ kid: 'k', signature: edSign(null, Buffer.from(replayed), agentKey.privateKey).toString('base64url') }),
        });
        expect(verdict).toMatchObject({ ok: false });
    });
});

describe('a bearer credential (no key)', () => {
    const bearer = () => credential({ holderKey: undefined });
    it('is accepted by default and the audit marks it none, so it does not look like a possession was shown', async () => {
        const { bought, event } = await run(bearer(), identities);
        expect(bought).toHaveLength(1);
        expect(event.mandate).toMatchObject({ holderBinding: 'none' });
    });
    it('is refused when the operator requires proof of possession', async () => {
        const { bought, event } = await run(bearer(), identities, { requireHolderBinding: true });
        expect(bought).toHaveLength(0);
        expect(event.reason).toMatch(/bearer credential/);
    });
});
