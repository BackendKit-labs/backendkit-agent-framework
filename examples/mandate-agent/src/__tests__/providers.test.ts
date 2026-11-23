/**
 * The framework is not tied to one identity provider. These tests run THE SAME agent (`agent.ts`, unchanged) under credentials from
 * different providers, each behind the framework's one contract (`MandateVerifier`), and under several at once.
 *
 * Three providers, three different ways of saying the same thing ("Carlos's agent may buy a television, up to 1000 EUR"):
 *   - eIDAS 2 (ASSUMED format): verbs of the domain, `represents`, `powers`;
 *   - the reference profile of `agent-mandates`: tool names, `resources`, `limits`;
 *   - a provider with no credential at all: the operator's own table of grants, answering the same contract.
 * The agent, the policy and the audit do not know which one they are talking to.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver, MandateVerifier } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { issueMandate, jwtMandateVerifier } from '@backendkit-labs/agent-mandates';
import { AGENT_ID, buildBuyerAgent, objectOf } from '../agent';
import { identityLayer } from '../identity/prototype';
import { AGENT_EIDAS2_IDENTITY, Eidas2Sim } from '../providers/eidas2-sim';
import { eidas2MandateVerifier } from '../providers/eidas2-assumed';
import { routeByIssuer } from '../providers/router';

const nowS = () => Math.floor(Date.now() / 1000);
const buyCall = (amount: number, item = 'television', id = 'c1') => ({ tool_calls: [{ id, name: 'buy_supplies', args: { item, amount, currency: 'EUR' } }] });

describe('the agent knows no identity provider', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'providers-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const human = (decision: 'approve' | 'reject'): Approver => ({
        ref: { kind: 'human', id: 'finance-lead' },
        request: async () => ({ decision, by: { kind: 'human', id: 'finance-lead' }, reason: decision, at: new Date().toISOString() }),
    });

    /** The same agent, whatever verifier it is given. */
    const agentWith = (verifier: MandateVerifier, amount: number, approver?: Approver) => buildBuyerAgent({
        provider: scriptedProvider([buyCall(amount), { content: 'done' }] as never), transport: mockTransport().transport, userId: 'carlos', agentIdentity: layer(),
        verifier, ...(approver ? { approver } : {}),
        auditLogPath: join(dir, `audit-${Math.random().toString(36).slice(2)}.ndjson`), checkpointsPath: join(dir, `cp-${Math.random().toString(36).slice(2)}.ndjson`),
    });

    // ── provider A: eIDAS 2 (assumed) ────────────────────────────────────────────────────────────────────────────
    const eidas2 = new Eidas2Sim();
    eidas2.registerAgent(AGENT_ID, AGENT_EIDAS2_IDENTITY);
    eidas2.registerHuman('carlos');
    const layer = () => identityLayer({ provider: eidas2.identityProvider(), require: true });
    const eidas2Credential = () => eidas2.issue({ agent: AGENT_EIDAS2_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [{ action: 'buy', object: 'television', max: { value: 1000, currency: 'EUR' } }] });
    const eidas2Verifier = (credential: () => string | undefined) => eidas2MandateVerifier({
        trustedIssuers: { [eidas2.issuer]: eidas2.publicKey }, credentialFor: () => credential(),
        objectOf,
        humanIdOf: (userId) => userId, humanKeyOf: (id, kid) => eidas2.humanPublicKey(id, kid),
    });

    // ── provider B: the reference profile of agent-mandates (names tools, not verbs) ────────────────────────────
    const company = generateKeyPairSync('ed25519');
    const COMPANY = 'did:example:company';
    const referenceCredential = (over: Record<string, unknown> = {}) => issueMandate({
        privateKey: company.privateKey, alg: 'EdDSA', issuer: COMPANY, subject: 'carlos', agent: AGENT_ID,
        actions: ['buy_supplies'], resources: ['television'], limits: { amount: { max: 1000, currency: 'EUR' } }, expiresAt: nowS() + 3600, ...over,
    });
    const referenceVerifier = (credential: () => string | undefined) => jwtMandateVerifier({
        trustedIssuers: { [COMPANY]: company.publicKey }, credentialFor: () => credential(),
    });

    // ── provider C: no credential, the operator's own table of grants ──────────────────────────────────────────
    const tableVerifier = (grants: Record<string, { max: number }>): MandateVerifier => ({
        async verify({ principal, call }) {
            const grant = grants[principal.userId ?? ''];
            if (!grant) return { ok: false, reason: 'the table has no grant for this person' };
            return { ok: true, mandate: { id: 'table-1', issuer: 'internal:grants-table', subject: principal.userId!, agent: AGENT_ID, actions: [call.tool.name], resources: ['television'], limits: { amount: { max: grant.max, currency: 'EUR' } } } };
        },
    });

    it('the agent\'s own source mentions no provider and imports none', () => {
        const source = readFileSync(join(__dirname, '..', 'agent.ts'), 'utf8');
        expect(source).not.toMatch(/eidas2/i);
        expect(source).not.toMatch(/from '\.\/providers/);
        expect(source).not.toMatch(/agent-mandates/);   // not even the reference package: it takes the framework's contract and nothing else
    });

    describe.each([
        ['eIDAS 2 (assumed)', (c: () => string | undefined) => eidas2Verifier(c), eidas2Credential],
        ['the reference profile of agent-mandates', (c: () => string | undefined) => referenceVerifier(c), () => referenceCredential()],
    ])('under %s', (_name, makeVerifier, issue) => {
        it('800 EUR for a television: buys alone', async () => {
            const a = agentWith(makeVerifier(() => issue()), 800);
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect(a.approvals).toHaveLength(0);
        });
        it('1200 EUR: asks a person, who may approve or refuse', async () => {
            const yes = agentWith(makeVerifier(() => issue()), 1200, human('approve'));
            await yes.engine.run('buy');
            expect(yes.approvals).toHaveLength(1);
            expect(yes.purchases).toHaveLength(1);
            const no = agentWith(makeVerifier(() => issue()), 1200, human('reject'));
            await no.engine.run('buy');
            expect(no.purchases).toHaveLength(0);
        });
        it('no credential: nothing is bought and nobody is asked', async () => {
            const a = agentWith(makeVerifier(() => undefined), 10, human('approve'));
            await a.engine.run('buy');
            expect(a.purchases).toHaveLength(0);
            expect(a.approvals).toHaveLength(0);
        });
    });

    it('under a provider with no credential at all (the operator\'s own table of grants), through the same contract', async () => {
        const inside = agentWith(tableVerifier({ carlos: { max: 1000 } }), 900);
        await inside.engine.run('buy');
        expect(inside.purchases).toHaveLength(1);
        const above = agentWith(tableVerifier({ carlos: { max: 1000 } }), 1500, human('reject'));
        await above.engine.run('buy');
        expect(above.approvals).toHaveLength(1);
        expect(above.purchases).toHaveLength(0);
        const nobody = agentWith(tableVerifier({ ana: { max: 1000 } }), 10, human('approve'));
        await nobody.engine.run('buy');
        expect(nobody.purchases).toHaveLength(0);
        expect(nobody.approvals).toHaveLength(0);
    });

    it('the audit says which provider\'s mandate the call ran under, whichever it was', async () => {
        const issuers: string[] = [];
        for (const [verifier, file] of [[eidas2Verifier(eidas2Credential), 'a'], [referenceVerifier(() => referenceCredential()), 'b'], [tableVerifier({ carlos: { max: 1000 } }), 'c']] as const) {
            const auditLogPath = join(dir, `audit-${file}.ndjson`);
            const a = buildBuyerAgent({ provider: scriptedProvider([buyCall(100), { content: 'done' }] as never), transport: mockTransport().transport, userId: 'carlos', agentIdentity: layer(), verifier, auditLogPath, checkpointsPath: join(dir, `cp-${file}.ndjson`) });
            await a.engine.run('buy');
            const ev = readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event).find(e => e.tool === 'buy_supplies');
            issuers.push(ev.mandate.issuer);
        }
        expect(issuers).toEqual([eidas2.issuer, COMPANY, 'internal:grants-table']);
    });

    describe('several providers at once, behind one router', () => {
        const verifierFor = (credential: () => string | undefined): MandateVerifier => routeByIssuer({
            credentialFor: () => credential(),
            routes: { [eidas2.issuer]: eidas2Verifier(credential), [COMPANY]: referenceVerifier(credential) },
        });

        it('a credential of either provider is read by its own verifier', async () => {
            const viaEidas2 = agentWith(verifierFor(() => eidas2Credential()), 500);
            await viaEidas2.engine.run('buy');
            expect(viaEidas2.purchases).toHaveLength(1);
            const viaCompany = agentWith(verifierFor(() => referenceCredential()), 500);
            await viaCompany.engine.run('buy');
            expect(viaCompany.purchases).toHaveLength(1);
        });

        it('each provider\'s own limits apply: the same 1200 EUR is refused under both', async () => {
            for (const credential of [eidas2Credential, () => referenceCredential()]) {
                const a = agentWith(verifierFor(() => credential()), 1200, human('reject'));
                await a.engine.run('buy');
                expect(a.approvals).toHaveLength(1);
                expect(a.purchases).toHaveLength(0);
            }
        });

        const deniedBy = async (credential: string | undefined, why: RegExp) => {
            const auditLogPath = join(dir, `audit-d-${Math.random().toString(36).slice(2)}.ndjson`);
            const a = buildBuyerAgent({ provider: scriptedProvider([buyCall(10), { content: 'x' }] as never), transport: mockTransport().transport, userId: 'carlos', agentIdentity: layer(), verifier: verifierFor(() => credential), approver: human('approve'), auditLogPath, checkpointsPath: join(dir, `cp-d-${Math.random().toString(36).slice(2)}.ndjson`) });
            await a.engine.run('buy');
            expect(a.purchases).toHaveLength(0);
            expect(a.approvals).toHaveLength(0);
            const ev = readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event).find(e => e.tool === 'buy_supplies');
            expect(ev.decision).toBe('deny');
            expect(ev.reason).toMatch(why);
        };

        it('a credential from an issuer no provider is configured for is refused', async () => {
            const stranger = generateKeyPairSync('ed25519');
            await deniedBy(issueMandate({ privateKey: stranger.privateKey, alg: 'EdDSA', issuer: 'did:example:unknown', subject: 'carlos', actions: ['buy_supplies'], expiresAt: nowS() + 3600 }), /no identity provider is configured/);
        });

        it('claiming one provider\'s name while signed with another\'s key does not get a credential accepted', async () => {
            // says it is eIDAS 2, signed by the company's key
            await deniedBy(issueMandate({ privateKey: company.privateKey, alg: 'EdDSA', issuer: eidas2.issuer, subject: 'carlos', actions: ['buy_supplies'], expiresAt: nowS() + 3600 }), /not valid|does not verify|signature|not a/);
            // says it is the company, signed by eIDAS 2's key
            const eidas2KeySigned = eidas2.issue({ agent: AGENT_EIDAS2_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [{ action: 'buy', max: { value: 1_000_000, currency: 'EUR' } }], payload: { iss: COMPANY } });
            await deniedBy(eidas2KeySigned, /signature does not verify/);
        });

        it('no credential, or garbage, is refused before any provider sees it', async () => {
            await deniedBy(undefined, /holds no power/);
            await deniedBy('not-a-jwt', /malformed/);
        });
    });
});
