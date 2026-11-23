/**
 * The credential as an eIDAS 2 wallet ecosystem would carry it: an SD-JWT VC (RFC 9901), with selective Disclosures, holder binding by a Key
 * Binding JWT, and revocation by a Token Status List reference. Run through the adapter, the engine, the identity layer and the audit.
 *
 * The CONTAINER is deduced from the public standards. The PAYLOAD (what a power-of-representation attestation says) is assumed.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver, MandateVerifier } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { AGENT_ID, buildBuyerAgent, objectOf } from '../agent';
import { AGENT_DALION_IDENTITY, DalionSim } from '../providers/dalion-sim';
import { dalionMandateVerifier, type DalionAdapterOptions, type DalionPower } from '../providers/dalion-assumed';
import { identityLayer, type AgentIdentityProvider, type IdentityAuditEvent } from '../identity/prototype';

const nowS = () => Math.floor(Date.now() / 1000);
/** The agent signs two kinds of bytes: a KB-JWT signing input (text) and the digest of an audit event (binary). Tell them apart by what they decode to. */
const isKbSigningInput = (t: string): boolean => {
    const [h, p, extra] = t.split('.');
    if (!h || !p || extra !== undefined) return false;
    try { return JSON.parse(Buffer.from(h, 'base64url').toString()).typ === 'kb+jwt'; } catch { return false; }
};
const TV_1000: DalionPower = { action: 'buy', object: 'television', max: { value: 1000, currency: 'EUR' } };

describe('the credential as an SD-JWT VC (eIDAS 2 container)', () => {
    let dir: string;
    let dalion: DalionSim;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'eidas-'));
        dalion = new DalionSim();
        dalion.registerAgent(AGENT_ID, AGENT_DALION_IDENTITY);
        dalion.registerHuman('carlos');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const log = () => join(dir, 'audit.ndjson');
    const buyEvent = () => readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event as IdentityAuditEvent).find(e => e.tool === 'buy_supplies')!;
    const credential = (over: Record<string, unknown> = {}) => dalion.issue({ agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [TV_1000], ...over });
    const verifier = (cred: () => string | undefined, extra: Partial<DalionAdapterOptions> = {}): MandateVerifier => dalionMandateVerifier({
        trustedIssuers: { [dalion.issuer]: dalion.publicKey }, credentialFor: () => cred(), objectOf,
        humanIdOf: (u) => u, humanKeyOf: (id, kid) => dalion.humanPublicKey(id, kid), isRevoked: dalion.isRevoked, ...extra,
    });
    function agent(v: MandateVerifier, provider: AgentIdentityProvider = dalion.identityProvider(), approver?: Approver) {
        return buildBuyerAgent({
            provider: scriptedProvider([{ tool_calls: [{ id: 'c', name: 'buy_supplies', args: { item: 'television', amount: 500, currency: 'EUR' } }] }, { content: 'done' }] as never),
            transport: mockTransport().transport, userId: 'carlos', verifier: v, ...(approver ? { approver } : {}),
            agentIdentity: identityLayer({ provider, require: true }), auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
        });
    }

    describe('selective disclosure', () => {
        it('a credential whose powers and person are hidden behind Disclosures is read once the holder discloses them, decoys and all', async () => {
            const cred = credential({ disclose: ['powers', 'represents'], decoys: 4 });
            expect(cred.split('~').length).toBeGreaterThan(3);               // jwt ~ powers ~ represents ~
            const a = agent(verifier(() => cred));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
        });

        it('what the holder does not disclose is not there: without the powers Disclosure the agent has no power', async () => {
            const [jwt, ...rest] = credential({ disclose: ['powers'] }).split('~');
            const withoutPowers = `${jwt}~${rest.slice(1).join('~')}`;       // the first Disclosure is `powers`; drop it
            const a = agent(verifier(() => withoutPowers));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/grants no powers/);
        });

        it('a Disclosure swapped in from another credential is refused', async () => {
            const other = credential({ disclose: ['powers'], powers: [{ action: 'buy', max: { value: 99_999, currency: 'EUR' } }] });
            const mine = credential({ disclose: ['powers'] });
            const frankenstein = `${mine.split('~')[0]}~${other.split('~')[1]}~`;
            const a = agent(verifier(() => frankenstein), dalion.identityProvider(), { ref: { kind: 'human', id: 'x' }, request: async () => ({ decision: 'approve', by: { kind: 'human', id: 'x' }, at: new Date().toISOString() }) });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/Disclosures of the credential are not valid/);
        });

        it('the consent still covers the real powers when they are hidden: widening them is caught even behind a Disclosure', async () => {
            // The issuer re-signs the credential with a bigger limit in a Disclosure the person never saw.
            const real = credential({ disclose: ['powers'] });
            const [jwt] = real.split('~');
            const widened = Buffer.from(JSON.stringify(['salt-x', 'powers', [{ ...TV_1000, max: { value: 50_000, currency: 'EUR' } }]])).toString('base64url');
            const payload = JSON.parse(Buffer.from(jwt!.split('.')[1]!, 'base64url').toString());
            const { createHash } = await import('node:crypto');
            payload._sd = [createHash('sha256').update(widened, 'ascii').digest('base64url')];
            const reissued = `${dalion.reissueWith(real, p => { p._sd = payload._sd; })}${widened}~`;
            const a = agent(verifier(() => reissued));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/person did not consent/);
        });
    });

    describe('key binding (KB-JWT)', () => {
        it('a credential tied to the agent\'s key: the presentation is a KB-JWT for this verifier, this request and this presentation', async () => {
            const a = agent(verifier(() => credential({ bindToKeyOf: AGENT_ID, disclose: ['powers'] })));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect((buyEvent().mandate as unknown as Record<string, unknown>).holderBinding).toBe('proven');
        });

        it('a different nonce on every verification: a proof is never reused', async () => {
            const signed: string[] = [];
            const real = dalion.identityProvider();
            const spy: AgentIdentityProvider = { resolve: (id, c) => real.resolve(id, c), sign: async (id, m) => { signed.push(Buffer.from(m).toString('ascii')); return real.sign(id, m); } };
            const v = verifier(() => credential({ bindToKeyOf: AGENT_ID }));
            const call = (id: string) => ({ tool_calls: [{ id, name: 'buy_supplies', args: { item: 'television', amount: 100, currency: 'EUR' } }] });
            const a = buildBuyerAgent({
                provider: scriptedProvider([call('c1'), call('c2'), { content: 'done' }] as never), transport: mockTransport().transport, userId: 'carlos', verifier: v,
                agentIdentity: identityLayer({ provider: spy, require: true }), auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
            });
            await a.engine.run('buy twice');
            // What the agent signs is the KB-JWT signing input for the proofs, and the digest of an event for the audit: keep only the first.
            const nonces = signed.flatMap(m => {
                const [h, p, extra] = m.split('.');
                if (!h || !p || extra !== undefined) return [];
                try {
                    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
                    return header.typ === 'kb+jwt' ? [JSON.parse(Buffer.from(p, 'base64url').toString()).nonce as string] : [];
                } catch { return []; }
            });
            expect(nonces.length).toBeGreaterThanOrEqual(2);
            expect(new Set(nonces).size).toBe(nonces.length);
        });

        it('what the agent signs is a kb+jwt addressed to this verifier, tied to the credential by sd_hash', async () => {
            let seen = '';
            const real = dalion.identityProvider();
            const spy: AgentIdentityProvider = { resolve: (id, c) => real.resolve(id, c), sign: async (id, m) => { const t = Buffer.from(m).toString('ascii'); if (isKbSigningInput(t)) seen = t; return real.sign(id, m); } };
            const a = agent(verifier(() => credential({ bindToKeyOf: AGENT_ID }), { audience: 'urn:verifier:acme' }), spy);
            await a.engine.run('buy a television');
            const [h, p] = seen.split('.') as [string, string];
            expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ typ: 'kb+jwt', alg: 'EdDSA' });
            expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ aud: 'urn:verifier:acme', nonce: expect.any(String), sd_hash: expect.any(String) });
        });

        it('a presentation string that already carries a KB-JWT is not accepted as is', async () => {
            const a = agent(verifier(() => `${credential({ bindToKeyOf: AGENT_ID })}aaa.bbb.ccc`));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/already carries a key binding proof/);
        });

        it('the same name, another key: refused with the reason from the standard\'s check', async () => {
            const real = dalion.identityProvider();
            const impostorKey = generateKeyPairSync('ed25519');
            const { sign } = await import('node:crypto');
            const impostor: AgentIdentityProvider = { resolve: (id, c) => real.resolve(id, c), sign: async (_i, m) => ({ kid: `${AGENT_DALION_IDENTITY}#key-1`, signature: sign(null, Buffer.from(m), impostorKey.privateKey).toString('base64url') }) };
            const a = agent(verifier(() => credential({ bindToKeyOf: AGENT_ID })), impostor);
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);
            expect(buyEvent().reason).toMatch(/not signed by the key the credential is tied to/);
        });
    });

    describe('revocation by Token Status List reference', () => {
        it('the credential carries status.status_list.{idx, uri} and the hook receives exactly that', async () => {
            let got: unknown;
            const a = agent(verifier(() => credential(), { isRevoked: (s) => { got = s; return false; } }));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect(got).toMatchObject({ credentialId: expect.any(String), status: { uri: 'https://status.dalion.example/lists/1', idx: expect.any(Number) } });
        });

        it('a status that says revoked, or cannot be read, refuses the credential', async () => {
            const revoked = agent(verifier(() => credential(), { isRevoked: () => true }));
            await revoked.engine.run('buy a television');
            expect(revoked.purchases).toHaveLength(0);
            const unreadable = agent(verifier(() => credential(), { isRevoked: () => { throw new Error('status list unreachable'); } }));
            await unreadable.engine.run('buy a television');
            expect(unreadable.purchases).toHaveLength(0);
        });
    });
});
