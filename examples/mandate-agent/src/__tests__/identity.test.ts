/**
 * SPEC-0044, as a prototype: the digital identity of the agent, whoever provides it.
 *
 * What is proved here, with the real engine, the real policy and the real hash-chained audit:
 *   - the identity the PROVIDER assigns reaches the audit and signs each action, for two different providers (DALION, assumed; a company IAM);
 *   - a credential tied to the agent's key is only good for whoever holds that key (the "bearer token" gap), and the audit says whether
 *     possession was proven or not;
 *   - an agent with no identity is refused when identity is required (SPEC-0044 D8), and warned about when it is not;
 *   - a provider that fails is a refusal, never a permission.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAuditChain, type MandateVerifier } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { issueMandate, jwtMandateVerifier } from '@backendkit-labs/agent-mandates';
import { AGENT_ID, buildBuyerAgent, objectOf } from '../agent';
import { AGENT_DALION_IDENTITY, DalionSim } from '../providers/dalion-sim';
import { dalionMandateVerifier, type DalionPower } from '../providers/dalion-assumed';
import { CorporateIdentity } from '../identity/corporate-identity';
import { identityLayer, verifyAgentSignatures, type AgentIdentityProvider, type IdentityAuditEvent } from '../identity/prototype';

const nowS = () => Math.floor(Date.now() / 1000);
const buyCall = (amount: number, id = 'c1') => ({ tool_calls: [{ id, name: 'buy_supplies', args: { item: 'television', amount, currency: 'EUR' } }] });
const TV_1000: DalionPower = { action: 'buy', object: 'television', max: { value: 1000, currency: 'EUR' } };

describe('the digital identity of the agent (SPEC-0044, prototype)', () => {
    let dir: string;
    let dalion: DalionSim;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'identity-')); dalion = new DalionSim(); dalion.registerAgent(AGENT_ID, AGENT_DALION_IDENTITY); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const log = () => join(dir, 'audit.ndjson');
    const events = () => readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event as IdentityAuditEvent);
    const buyEvent = () => events().find(e => e.tool === 'buy_supplies')!;

    const dalionVerifier = (credential: () => string | undefined, extra: { requireHolderBinding?: boolean } = {}): MandateVerifier => dalionMandateVerifier({
        trustedIssuers: { [dalion.issuer]: dalion.publicKey }, credentialFor: () => credential(), objectOf, isRevoked: dalion.isRevoked, ...extra,
    });
    const credential = (over: Record<string, unknown> = {}) => dalion.issue({
        agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [TV_1000], ...over,
    });

    function agent(opts: { verifier: MandateVerifier; provider: AgentIdentityProvider; require?: boolean; warn?: (m: string) => void; amount?: number }) {
        return buildBuyerAgent({
            provider: scriptedProvider([buyCall(opts.amount ?? 500), { content: 'done' }] as never), transport: mockTransport().transport, userId: 'carlos',
            verifier: opts.verifier,
            agentIdentity: identityLayer({ provider: opts.provider, require: opts.require ?? true, ...(opts.warn ? { warn: opts.warn } : {}) }),
            auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
        });
    }

    describe('attribution and signature, whoever the provider is', () => {
        it('DALION (assumed): the audit names the identity DALION assigned, and that identity signed the event', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            const ev = buyEvent();
            expect(ev.agentIdentity).toEqual({ id: AGENT_DALION_IDENTITY, issuer: dalion.issuer, kid: `${AGENT_DALION_IDENTITY}#key-1` });
            expect(ev.agentSignature?.kid).toBe(ev.agentIdentity!.kid);
            const check = verifyAgentSignatures(log(), kid => dalion.publicKeyOfKid(kid));
            expect(check).toMatchObject({ ok: true });
            expect(check.checked).toBeGreaterThan(0);
        });

        it('a company IAM with its keys in a KMS: another kind of identifier, another custody, the same design', async () => {
            const acme = new CorporateIdentity();
            acme.register(AGENT_ID);
            const reference = new (class { key = generateKeyPairSync('ed25519'); })();
            const cred = issueMandate({ privateKey: reference.key.privateKey, alg: 'EdDSA', issuer: 'did:example:company', subject: 'carlos', agent: AGENT_ID, actions: ['buy_supplies'], resources: ['television'], limits: { amount: { max: 1000, currency: 'EUR' } }, expiresAt: nowS() + 3600 });
            const verifier = jwtMandateVerifier({ trustedIssuers: { 'did:example:company': reference.key.publicKey }, credentialFor: () => cred });
            const a = agent({ verifier, provider: acme.provider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            const ev = buyEvent();
            expect(ev.agentIdentity).toEqual({ id: `urn:acme:agent:${AGENT_ID}`, issuer: 'urn:acme:iam', kid: `acme-kms/${AGENT_ID}/v1` });
            expect(verifyAgentSignatures(log(), kid => acme.publicKeyOfKid(kid))).toMatchObject({ ok: true });
            // the reference credential is not tied to any key: the audit does not pretend otherwise
            expect((ev.mandate as unknown as Record<string, unknown>).holderBinding).toBe('none');
        });

        it('every event of the run is signed (the denied and the read-only ones too), and the hash chain still verifies', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(events().every(e => e.agentSignature !== undefined)).toBe(true);
            expect(verifyAuditChain(log()).ok).toBe(true);
        });

        it('an event edited after the fact fails its signature, even if the chain is rebuilt around it', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            const lines = readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
            lines[0].event.argsHash = '0'.repeat(64);          // change what was bought; the chain is not even rebuilt here: the signature is the one that catches it
            writeFileSync(log(), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
            const check = verifyAgentSignatures(log(), kid => dalion.publicKeyOfKid(kid));
            expect(check.ok).toBe(false);
            expect(check.failures[0].reason).toMatch(/does not verify/);
        });

        it('an event that names one identity but was signed by another is caught', async () => {
            const acme = new CorporateIdentity();
            acme.register(AGENT_ID);
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            const lines = readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
            lines[0].event.agentSignature.kid = `acme-kms/${AGENT_ID}/v1`;       // claims the company's key signed it
            writeFileSync(log(), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
            const check = verifyAgentSignatures(log(), kid => acme.publicKeyOfKid(kid) ?? dalion.publicKeyOfKid(kid));
            expect(check.ok).toBe(false);
            expect(check.failures[0].reason).toMatch(/not the one of the identity it names/);
        });

        it('a key that is not the identity\'s own does not verify', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            const other = generateKeyPairSync('ed25519');
            expect(verifyAgentSignatures(log(), () => other.publicKey).ok).toBe(false);
        });
    });

    describe('the credential is tied to the agent, not just to a name', () => {
        it('a credential tied to the agent\'s key: the agent proves it holds the key, and the audit says so', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential({ bindToKeyOf: AGENT_ID })), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            const mandate = buyEvent().mandate as unknown as Record<string, unknown>;
            expect(mandate.holderBinding).toBe('proven');
            expect(mandate.agentIdentity).toBe(AGENT_DALION_IDENTITY);
        });

        it('THE BEARER GAP: the same identity name, a different key, and the credential is refused', async () => {
            // The credential is tied to the real agent's key. An impostor is told by its provider that it is the same agent (same id) but it
            // signs with another key: the name matches, the possession does not.
            const real = dalion.identityProvider();
            const cred = credential({ bindToKeyOf: AGENT_ID });
            const impostorKey = generateKeyPairSync('ed25519');
            const { sign } = await import('node:crypto');
            const impostor: AgentIdentityProvider = {
                resolve: (id) => real.resolve(id),
                sign: async (_id, message) => ({ kid: `${AGENT_DALION_IDENTITY}#key-1`, signature: sign(null, Buffer.from(message), impostorKey.privateKey).toString('base64url') }),
            };
            const a = agent({ verifier: dalionVerifier(() => cred), provider: impostor });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().decision).toBe('deny');
            expect(buyEvent().reason).toMatch(/could not prove possession/);
        });

        it('a proof signed by a key other than the one the credential is tied to is refused', async () => {
            const real = dalion.identityProvider();
            const other = dalion.registerAgent('other', 'did:dalion:agent:other-01');
            const cred = credential({ bindToKeyOf: AGENT_ID });
            const wrong: AgentIdentityProvider = { resolve: (id) => real.resolve(id), sign: (_id, m) => real.sign('other', m) };
            void other;
            const a = agent({ verifier: dalionVerifier(() => cred), provider: wrong });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/other than the one the credential is tied to/);
        });

        it('a bearer credential (no key) is accepted by default and marked `none`: the audit does not claim a possession nobody proved', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect((buyEvent().mandate as unknown as Record<string, unknown>).holderBinding).toBe('none');
        });

        it('a deployment that requires proof of possession refuses a bearer credential', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential(), { requireHolderBinding: true }), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/bearer credential/);
        });

        it('whatever verifier answers, a mandate bound to another identity than the provider gives this agent is refused by the layer', async () => {
            const bound = (identity: string): MandateVerifier => ({
                verify: async ({ principal }) => ({ ok: true, mandate: { id: 'm', issuer: 'any', subject: 'carlos', agent: principal.agentId, actions: ['buy_supplies'], agentIdentity: identity } as never }),
            });
            const wrong = agent({ verifier: bound('did:example:somebody-else'), provider: dalion.identityProvider() });
            await wrong.engine.run('buy');
            expect(wrong.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/bound to another agent identity/);
            const right = agent({ verifier: bound(AGENT_DALION_IDENTITY), provider: dalion.identityProvider() });
            await right.engine.run('buy');
            expect(right.purchases).toHaveLength(1);
        });

        it('a credential issued to another identity than the one the provider gives this agent is refused', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential({ agent: 'did:dalion:agent:somebody-else' })), provider: dalion.identityProvider() });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/another agent identity/);
        });
    });

    describe('each piece defends on its own (the layers are not relied on to cover each other)', () => {
        const request = (identity?: { id: string }) => ({
            principal: { agentId: AGENT_ID, sessionId: 's', chain: [AGENT_ID], userId: 'carlos', ...(identity ? { agentIdentity: identity } : {}) },
            call: { tool: { name: 'buy_supplies', meta: { capability: 'buy' } } as never, args: { item: 'television' } },
        });

        it('the adapter alone compares the credential\'s agent with the identity it was given', async () => {
            const r = await dalionVerifier(() => credential()).verify(request({ id: 'did:dalion:agent:somebody-else' }) as never);
            expect(r).toMatchObject({ ok: false });
            if (!r.ok) expect(r.reason).toMatch(/issued to another agent identity/);
        });

        it('the adapter alone refuses when the engine gives the agent no identity', async () => {
            const r = await dalionVerifier(() => credential()).verify(request() as never);
            expect(r).toMatchObject({ ok: false });
            if (!r.ok) expect(r.reason).toMatch(/gives this agent no digital identity/);
        });

        it('the verifier layer alone refuses an agent with no identity when it is required', async () => {
            const none: AgentIdentityProvider = { resolve: async () => undefined, sign: async () => { throw new Error('x'); } };
            const wrapped = identityLayer({ provider: none, require: true }).verifier(dalionVerifier(() => credential()));
            const r = await wrapped.verify(request() as never);
            expect(r).toMatchObject({ ok: false });
            if (!r.ok) expect(r.reason).toMatch(/has no digital identity/);
        });
    });

    describe('an agent carries an identity (SPEC-0044 D8)', () => {
        const noIdentity: AgentIdentityProvider = { resolve: async () => undefined, sign: async () => { throw new Error('nothing to sign with'); } };

        it('required: an agent with no identity is refused, whatever it asks for, and the audit says why', async () => {
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: noIdentity, require: true });
            const out = await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(out.toolCalls.every(c => c.success === false)).toBe(true);
            expect(buyEvent().decision).toBe('deny');
            expect(buyEvent().reason).toMatch(/has no digital identity/);
            expect(buyEvent().agentIdentityMissing).toBe(true);
        });

        it('required: even a read-only look-up needs an identity', async () => {
            const t = mockTransport();
            const a = buildBuyerAgent({
                provider: scriptedProvider([{ tool_calls: [{ id: 'p', name: 'check_price', args: { item: 'television' } }] }, { content: 'x' }] as never), transport: t.transport, userId: 'carlos',
                verifier: dalionVerifier(() => credential()), agentIdentity: identityLayer({ provider: noIdentity, require: true }), auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
            });
            const out = await a.engine.run('price?');
            expect(out.toolCalls.map(c => `${c.name}:${c.success}`)).toEqual(['check_price:false']);
        });

        it('not required (the transition): it works, warns ONCE, and the log records that the identity was missing', async () => {
            const warnings: string[] = [];
            const script = [buyCall(100, 'c1'), buyCall(100, 'c2'), { content: 'done' }];
            const a = buildBuyerAgent({
                provider: scriptedProvider(script as never), transport: mockTransport().transport, userId: 'carlos', verifier: dalionVerifier(() => credential({ agent: 'did:dalion:agent:x' })),
                agentIdentity: identityLayer({ provider: noIdentity, require: false, warn: m => warnings.push(m) }), auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
            });
            await a.engine.run('buy twice');
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toMatch(/no digital identity/);
            expect(events().every(e => e.agentIdentityMissing === true && e.agentSignature === undefined)).toBe(true);
            expect(verifyAgentSignatures(log(), () => undefined)).toMatchObject({ ok: true, checked: 0 });
        });

        it('a provider that fails is a refusal, not a permission', async () => {
            const broken: AgentIdentityProvider = { resolve: async () => { throw new Error('IAM is down'); }, sign: async () => { throw new Error('IAM is down'); } };
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: broken });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/identity provider failed: IAM is down/);
        });

        it('a custody that cannot sign does not lose the record: the event is written, marked unsigned, and the check reports it', async () => {
            const real = dalion.identityProvider();
            const cannotSign: AgentIdentityProvider = { resolve: (id) => real.resolve(id), sign: async () => { throw new Error('custody unavailable'); } };
            const a = agent({ verifier: dalionVerifier(() => credential()), provider: cannotSign });
            const out = await a.engine.run('buy a television');
            expect(out.errors).toEqual([]);
            expect(a.purchases).toHaveLength(1);                       // the action happened...
            const ev = buyEvent();                                     // ...and it is in the log: a lost record is worse than an unsigned one
            expect(ev.agentSignatureFailed).toBe(true);
            expect(ev.agentSignature).toBeUndefined();
            const check = verifyAgentSignatures(log(), kid => dalion.publicKeyOfKid(kid));
            expect(check.ok).toBe(false);                              // it cannot pass for a signed event
            expect(check.failures[0].reason).toMatch(/could not sign/);
        });
    });
});
