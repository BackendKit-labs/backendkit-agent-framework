/**
 * SPEC-0044 F2: every audit event is signed by the identity that executed the call, and whoever holds the PUBLIC keys can check it, even if
 * they rewrote the whole log. The proof is opaque: Ed25519 is checked by `core`, any other format only by a verifier the operator registers.
 */
import { generateKeyPairSync, createHash, sign as edSign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { HashChainAuditSink, verifyAuditChain } from '../../governance/audit';
import { ed25519Signer, checkpointMessage, readCheckpoints } from '../../governance/audit-checkpoint';
import { exportAuditBundle, verifyAuditBundle } from '../../governance/audit-bundle';
import { ed25519AgentIdentities, selfAssertedIdentities, type AgentIdentityProvider } from '../../governance/agent-identity';
import { agentSignatureProblem, eventSigningMessage, type AgentSignatureCheckOptions } from '../../governance/agent-signature';
import type { AuditEvent, ToolDefinition } from '../../index';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, allowedTools: ['read_file'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: ['read_file'], delegatesTo: [] };
const tools: ToolDefinition[] = [{ name: 'read_file', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => 'content' }];
const calls = (...n: string[]): Turn => ({ tool_calls: n.map((name, i) => ({ id: `c${i}`, name, args: {} })) });
const key = () => generateKeyPairSync('ed25519').privateKey;

describe('agent signatures on the audit', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-sig-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const log = () => join(dir, 'audit.ndjson');

    const providerOf = () => ed25519AgentIdentities({ [agent.id]: { id: 'did:ex:main', privateKey: key() }, helper: { id: 'did:ex:helper', privateKey: key() } });

    function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}) {
        const { transport } = createMockTransport();
        return createBaseEngine({
            providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [agent, helper], defaultAgent: agent.id, tools,
            transport, workingDir: process.cwd(), iterationMode: 'auto', sessionId: 's1', identity: { userId: 'alice' },
            audit: new HashChainAuditSink(log()), ...extra,
        });
    }
    const keysOf = (p: ReturnType<typeof providerOf>): AgentSignatureCheckOptions => ({ keyOf: (kid) => p.publicKeyOf(kid) });
    const entries = () => readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { seq: number; event: AuditEvent });

    it('a signed run verifies with the public keys, and says how many events were signed', async () => {
        const p = providerOf();
        await build([calls('read_file', 'read_file'), { content: 'done' }], { agentIdentity: p }).run('go');
        expect(entries().every(e => e.event.agentSignature && e.event.agentIdentity?.kid)).toBe(true);
        expect(verifyAuditChain(log(), { agentSignatures: keysOf(p) })).toMatchObject({ ok: true, entries: 2, signedEvents: 2 });
    });

    it('without asking for it, verification is what it was: the chain only', async () => {
        const p = providerOf();
        await build([calls('read_file'), { content: 'done' }], { agentIdentity: p }).run('go');
        const r = verifyAuditChain(log());
        expect(r.ok).toBe(true);
        expect(r).not.toHaveProperty('signedEvents');
    });

    it('an event edited and re-chained by someone who rewrote the whole log does not verify: the signature covers the content', async () => {
        const p = providerOf();
        await build([calls('read_file'), { content: 'done' }], { agentIdentity: p }).run('go');
        // The attacker rewrites the log with a valid hash chain, changing what the agent did.
        const forged = join(dir, 'forged.ndjson');
        const sink = new HashChainAuditSink(forged);
        for (const e of entries()) sink.write({ ...e.event, decision: 'deny', reason: 'edited' });
        expect(verifyAuditChain(forged).ok).toBe(true);                                  // the chain alone is fooled
        expect(verifyAuditChain(forged, { agentSignatures: keysOf(p) })).toMatchObject({ ok: false, reason: expect.stringMatching(/agent signature: the signature does not verify/) });
    });

    it('a signature by the key of ANOTHER identity does not pass for the one the event names', () => {
        const p = providerOf();
        const main = p.resolve(agent.id, { sessionId: 's' }) as { id: string; kid: string };
        const helperKid = (p.resolve('helper', { sessionId: 's' }) as { kid: string }).kid;
        const event: AuditEvent = { at: 'now', principal: { agentId: agent.id, sessionId: 's', chain: [agent.id] }, tool: 't', argsHash: 'x', decision: 'allow', durationMs: 0, agentIdentity: main };
        const other = p.sign!('helper', eventSigningMessage(event), { sessionId: 's' }) as { kid: string; signature: string };
        expect(other.kid).toBe(helperKid);
        expect(agentSignatureProblem({ ...event, agentSignature: other }, keysOf(p))).toMatch(/not the one of the identity it names/);
        // same kid claimed, someone else's private key
        const claimed = { kid: main.kid, signature: edSign(null, eventSigningMessage(event), key()).toString('base64url') };
        expect(agentSignatureProblem({ ...event, agentSignature: claimed }, keysOf(p))).toMatch(/does not verify/);
    });

    it('a key you do not trust is no proof: with no public key for the kid, it does not verify', async () => {
        const p = providerOf();
        await build([calls('read_file'), { content: 'done' }], { agentIdentity: p }).run('go');
        expect(verifyAuditChain(log(), { agentSignatures: { keyOf: () => undefined } })).toMatchObject({ ok: false, reason: expect.stringMatching(/no trusted public key/) });
    });

    it('in a delegation, each agent signs with its own key', async () => {
        const p = providerOf();
        await build([{ tool_calls: [{ id: 'd', name: 'ask_agent', args: { agent_id: 'helper', question: 'q' } }] }, calls('read_file'), { content: 'h' }, { content: 'done' }], { agentIdentity: p }).run('go');
        const byAgent = Object.fromEntries(entries().map(e => [e.event.principal.agentId, e.event.agentSignature?.kid]));
        expect(byAgent).toMatchObject({ [agent.id]: 'did:ex:main#key-1', helper: 'did:ex:helper#key-1' });
        expect(verifyAuditChain(log(), { agentSignatures: keysOf(p) })).toMatchObject({ ok: true });
    });

    it('an asynchronous custody (a KMS) works, and the engine waits for the signature', async () => {
        const inner = providerOf();
        const kms: AgentIdentityProvider = { resolve: inner.resolve, sign: async (id, m, c) => { await new Promise(r => setTimeout(r, 25)); return inner.sign!(id, m, c); } };
        const started = Date.now();
        await build([calls('read_file'), { content: 'done' }], { agentIdentity: kms }).run('go');
        expect(Date.now() - started).toBeGreaterThanOrEqual(20);
        expect(verifyAuditChain(log(), { agentSignatures: keysOf(inner) })).toMatchObject({ ok: true, signedEvents: 1 });
    });

    describe('a custody that cannot sign does not lose the record', () => {
        const unsignable = (sign: AgentIdentityProvider['sign']): AgentIdentityProvider => ({ resolve: (id) => ({ id: `did:ex:${id}`, kid: 'k' }), sign });

        it('it throws: the event is written, marked, the run is not affected, and a verifier never accepts it', async () => {
            const result = await build([calls('read_file'), { content: 'done' }], { agentIdentity: unsignable(() => { throw new Error('custody down'); }) }).run('go');
            expect(result.toolCalls.map(c => c.success)).toEqual([true]);
            expect(entries()[0]!.event).toMatchObject({ agentSignatureFailed: true, decision: 'allow' });
            expect(entries()[0]!.event.agentSignature).toBeUndefined();
            expect(verifyAuditChain(log(), { agentSignatures: { allowUnsigned: true } })).toMatchObject({ ok: false, reason: expect.stringMatching(/could not sign/) });
        });

        it('it is too slow: same, within the identity timeout', async () => {
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: unsignable(() => new Promise<never>(() => undefined)), agentIdentityTimeoutMs: 30 }).run('go');
            expect(entries()[0]!.event.agentSignatureFailed).toBe(true);
        });

        it('it returns something that is not a proof: same', async () => {
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: unsignable(() => ({ kid: '', signature: '' })) }).run('go');
            expect(entries()[0]!.event.agentSignatureFailed).toBe(true);
        });
    });

    describe('the proof is opaque (D12)', () => {
        const sealing = (): AgentIdentityProvider => ({
            resolve: (id) => ({ id: `did:ex:${id}`, kid: 'seal-1' }),
            sign: (_id, m) => ({ kid: 'seal-1', format: 'test-seal', signature: Buffer.from(m).toString('base64url').split('').reverse().join('') }),
        });
        const sealOk = ({ message, proof }: { message: Buffer; proof: { signature: string } }) => proof.signature === message.toString('base64url').split('').reverse().join('');

        it('a format core does not know is recorded, and not verified unless the operator registers a verifier for it', async () => {
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: sealing() }).run('go');
            expect(entries()[0]!.event.agentSignature).toMatchObject({ format: 'test-seal' });
            expect(verifyAuditChain(log(), { agentSignatures: {} })).toMatchObject({ ok: false, reason: expect.stringMatching(/no verifier is registered for the proof format "test-seal"/) });
            expect(verifyAuditChain(log(), { agentSignatures: { formats: { 'test-seal': sealOk } } })).toMatchObject({ ok: true, signedEvents: 1 });
        });

        it('the verifier decides: one that says no, or throws, fails the event', async () => {
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: sealing() }).run('go');
            expect(verifyAuditChain(log(), { agentSignatures: { formats: { 'test-seal': () => false } } }).ok).toBe(false);
            expect(verifyAuditChain(log(), { agentSignatures: { formats: { 'test-seal': () => { throw new Error('x'); } } } }).ok).toBe(false);
        });

        it('a format named like an inherited property is not a verifier', () => {
            const event: AuditEvent = { at: 'n', principal: { agentId: 'a', sessionId: 's', chain: ['a'] }, tool: 't', argsHash: 'x', decision: 'allow', durationMs: 0, agentIdentity: { id: 'i' }, agentSignature: { kid: 'k', signature: 's', format: 'constructor' } };
            expect(agentSignatureProblem(event, { formats: {} })).toMatch(/no verifier is registered/);
        });
    });

    describe('what is not signed', () => {
        it('signAuditEvents: false records only the identity; a verifier asks for signatures unless told unsigned is fine', async () => {
            const p = providerOf();
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: p, signAuditEvents: false }).run('go');
            expect(entries()[0]!.event).toMatchObject({ agentIdentity: { id: 'did:ex:main' } });
            expect(entries()[0]!.event.agentSignature).toBeUndefined();
            expect(entries()[0]!.event.agentSignatureFailed).toBeUndefined();
            expect(verifyAuditChain(log(), { agentSignatures: keysOf(p) }).ok).toBe(false);
            expect(verifyAuditChain(log(), { agentSignatures: { ...keysOf(p), allowUnsigned: true } })).toMatchObject({ ok: true, signedEvents: 0 });
        });

        it('a provider that does not sign only attributes: same as above', async () => {
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: selfAssertedIdentities() }).run('go');
            expect(entries()[0]!.event.agentSignature).toBeUndefined();
            expect(verifyAuditChain(log(), { agentSignatures: {} }).ok).toBe(false);
            expect(verifyAuditChain(log(), { agentSignatures: { allowUnsigned: true } }).ok).toBe(true);
        });

        it('an agent that ran with no identity says so, and that is not a missing signature', async () => {
            await build([calls('read_file'), { content: 'done' }], { requireAgentIdentity: false }).run('go');
            expect(entries()[0]!.event.agentIdentityMissing).toBe(true);
            expect(verifyAuditChain(log(), { agentSignatures: {} })).toMatchObject({ ok: true, signedEvents: 0 });
        });

        it('an event with neither a signature nor the mark of having no identity is refused', () => {
            const event: AuditEvent = { at: 'n', principal: { agentId: 'a', sessionId: 's', chain: ['a'] }, tool: 't', argsHash: 'x', decision: 'allow', durationMs: 0 };
            expect(agentSignatureProblem(event, {})).toMatch(/neither signed nor marked/);
        });
    });

    describe('bundles', () => {
        it('a bundle verifies the agent signatures with the keys YOU hold, and a tampered event fails', async () => {
            const p = providerOf();
            const checkpoints = join(dir, 'cp.ndjson');
            const operator = generateKeyPairSync('ed25519');
            const sink = new HashChainAuditSink(log(), { checkpoints: { signer: ed25519Signer(operator.privateKey, 'op-1'), path: checkpoints } });
            await build([calls('read_file'), { content: 'done' }], { agentIdentity: p, audit: sink }).run('go');
            sink.checkpoint();
            const out = join(dir, 'bundle');
            exportAuditBundle({ log: log(), checkpoints, publicKeys: { 'op-1': operator.publicKey }, outDir: out });
            expect(verifyAuditBundle(out, { trustedKeys: { 'op-1': operator.publicKey }, agentSignatures: keysOf(p) })).toMatchObject({ ok: true, signedEvents: 1 });

            const forged = readFileSync(join(out, 'audit.ndjson'), 'utf8').replace('"decision":"allow"', '"decision":"deny"');
            writeFileSync(join(out, 'audit.ndjson'), forged);
            expect(verifyAuditBundle(out, { trustedKeys: { 'op-1': operator.publicKey }, agentSignatures: keysOf(p) }).ok).toBe(false);
        });
    });
});

describe('an asynchronous checkpoint signer (a KMS, an HSM)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-cp-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const event = (n: number): AuditEvent => ({ at: 'n', principal: { agentId: 'a', sessionId: 's', chain: ['a'] }, tool: `t${n}`, argsHash: 'x', decision: 'allow', durationMs: 0 });
    const pair = generateKeyPairSync('ed25519');
    const asyncSigner = (): import('../../governance/audit-checkpoint').CheckpointSigner => ({
        kid: 'kms-1',
        sign: async (m) => { await new Promise(r => setTimeout(r, 10)); return edSign(null, m, pair.privateKey).toString('base64url'); },
    });

    it('signs every N entries and the engine-side write waits for it: the checkpoint is on disk before write resolves', async () => {
        const path = join(dir, 'cp.ndjson');
        const sink = new HashChainAuditSink(join(dir, 'audit.ndjson'), { checkpoints: { signer: asyncSigner(), path, every: 2 } });
        await sink.write(event(1));
        expect(readCheckpoints(path)).toHaveLength(0);
        await sink.write(event(2));
        const [cp] = readCheckpoints(path);
        expect(cp).toMatchObject({ seq: 2, kid: 'kms-1' });
        const ok = createHash('sha256').update('x').digest().length === 32;   // sanity that crypto is loaded
        expect(ok).toBe(true);
        const { verify } = await import('node:crypto');
        expect(verify(null, checkpointMessage(cp!), pair.publicKey, Buffer.from(cp!.sig, 'base64url'))).toBe(true);
    });

    it('the synchronous checkpoint() says to use checkpointAsync(); checkpointAsync() works with either kind of signer', async () => {
        const sink = new HashChainAuditSink(join(dir, 'audit.ndjson'), { checkpoints: { signer: asyncSigner(), path: join(dir, 'cp.ndjson') } });
        await sink.write(event(1));
        expect(() => sink.checkpoint()).toThrow(/asynchronous: use checkpointAsync/);
        expect(await sink.checkpointAsync()).toMatchObject({ seq: 1, kid: 'kms-1' });
        const syncSink = new HashChainAuditSink(join(dir, 'a2.ndjson'), { checkpoints: { signer: ed25519Signer(pair.privateKey, 'k'), path: join(dir, 'cp2.ndjson') } });
        syncSink.write(event(1));
        expect(await syncSink.checkpointAsync()).toMatchObject({ seq: 1, kid: 'k' });
    });
});
