/**
 * Anchors of the audit log (SPEC-0042 F2): the head put outside the operator's reach, and the verifier that checks it with
 * the anchors IT trusts. The headline test is the one the signed checkpoints alone could not pass: whoever holds the
 * signing key rewrites the whole log, signs it again, and is still caught.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashChainAuditSink } from '../audit';
import { anchorAuditLog, fileAnchor, readAnchors, type AnchorRecord, type TimestampAnchor } from '../audit-anchor';
import { ed25519Signer } from '../audit-checkpoint';
import { exportAuditBundle, verifyAuditBundle, verifyAuditBundleAnchored } from '../audit-bundle';
import type { AuditEvent } from '../types';

const event = (n: number, tool = `tool-${n}`): AuditEvent => ({
    at: `2026-11-21T10:00:0${n % 10}.000Z`, principal: { agentId: 'main', sessionId: 's', chain: ['main'] },
    tool, argsHash: 'a'.repeat(64), decision: 'allow', outcome: 'ok', durationMs: 1,
} as AuditEvent);

const keys = () => generateKeyPairSync('ed25519');

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'audit-anchor-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const p = () => ({
    log: join(dir, 'audit.ndjson'), cps: join(dir, 'checkpoints.ndjson'), anchors: join(dir, 'anchors.ndjson'),
    witness: join(dir, 'witness', 'heads.ndjson'), out: join(dir, 'bundle'),
});

/** A log of `n` entries, signed with `k`, anchored in the witness file. The witness is "outside the operator's reach". */
async function operator(n: number, k: { privateKey: KeyObject }, anchorAt: number[] = [n]) {
    const { log, cps, anchors, witness } = p();
    const sink = new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k.privateKey, 'k1'), path: cps } });
    for (let i = 1; i <= n; i++) {
        sink.write(event(i));
        if (anchorAt.includes(i)) await anchorAuditLog({ log, anchors, anchor: fileAnchor(witness) });
    }
    sink.checkpoint();
    return sink;
}

function exportBundle(k: { publicKey: KeyObject }) {
    const { log, cps, anchors, out } = p();
    return exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k.publicKey }, anchors, outDir: out });
}

describe('anchoring a log', () => {
    it('anchors the current head in the witness and records what the anchor returned', async () => {
        const k = keys();
        const sink = await operator(3, k);
        const { anchors, witness } = p();
        const [record] = readAnchors(anchors);
        expect(record).toMatchObject({ seq: 3, head: sink.head, kind: 'file', ref: witness });
        expect(readFileSync(witness, 'utf8')).toContain(sink.head);
    });

    it('asking again with the same head writes nothing more', async () => {
        const k = keys();
        await operator(3, k);
        const { log, anchors, witness } = p();
        const again = await anchorAuditLog({ log, anchors, anchor: fileAnchor(witness) });
        expect(again.seq).toBe(3);
        expect(readAnchors(anchors)).toHaveLength(1);
        expect(readFileSync(witness, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
    });

    it('refuses an empty log, a broken log, and an anchor that answers for another point', async () => {
        const { log, anchors, witness } = p();
        await expect(anchorAuditLog({ log, anchors, anchor: fileAnchor(witness) })).rejects.toThrow(/empty/);
        const sink = new HashChainAuditSink(log);
        sink.write(event(1)); sink.write(event(2)); sink.write(event(3));
        const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
        writeFileSync(log, [lines[0], lines[2]].join('\n') + '\n');
        await expect(anchorAuditLog({ log, anchors, anchor: fileAnchor(witness) })).rejects.toThrow(/not intact/);

        const fresh = join(dir, 'fresh.ndjson');
        const s2 = new HashChainAuditSink(fresh);
        s2.write(event(1));
        const liar: TimestampAnchor = { kind: 'file', anchor: async ({ seq }) => ({ seq, head: 'f'.repeat(64), kind: 'file', at: new Date().toISOString() }), verify: async () => ({ ok: true }) };
        await expect(anchorAuditLog({ log: fresh, anchors, anchor: liar })).rejects.toThrow(/another point/);
        expect(readAnchors(anchors)).toEqual([]);
    });

    it('the file anchor checks its own copy, not the path a record claims', async () => {
        const k = keys();
        await operator(2, k);
        const { anchors, witness } = p();
        const [record] = readAnchors(anchors);
        expect(await fileAnchor(witness).verify(record!)).toEqual({ ok: true });
        expect(await fileAnchor(join(dir, 'other.ndjson')).verify(record!)).toMatchObject({ ok: false, reason: expect.stringContaining('does not exist') });
        writeFileSync(join(dir, 'empty.ndjson'), '');
        expect(await fileAnchor(join(dir, 'empty.ndjson')).verify(record!)).toMatchObject({ ok: false, reason: expect.stringContaining('no record') });
    });
});

describe('a bundle with anchors', () => {
    it('the offline check lists the records but does not call the log anchored', async () => {
        const k = keys();
        await operator(4, k);
        exportBundle(k);
        const r = verifyAuditBundle(p().out, { trustedKeys: { k1: k.publicKey } });
        expect(r).toMatchObject({ ok: true, anchored: false, anchoredUpTo: 0, anchorRecords: 1 });
        expect(r.ok && r.warnings.join(' ')).toMatch(/1 anchor records are in the bundle but were not verified/);
    });

    it('checked with the verifier\'s own witness, the log is anchored up to the entry the anchor covers', async () => {
        const k = keys();
        await operator(4, k);
        exportBundle(k);
        const r = await verifyAuditBundleAnchored(p().out, { trustedKeys: { k1: k.publicKey }, anchors: [fileAnchor(p().witness)] });
        expect(r).toMatchObject({ ok: true, anchored: true, anchoredUpTo: 4, anchorRecords: 1, entries: 4 });
        expect(r.ok && r.warnings.join(' ')).not.toMatch(/not anchored/);
    });

    it('entries after the last verified anchor are reported as not anchored', async () => {
        const k = keys();
        await operator(7, k, [3, 5]);
        exportBundle(k);
        const r = await verifyAuditBundleAnchored(p().out, { trustedKeys: { k1: k.publicKey }, anchors: [fileAnchor(p().witness)] });
        expect(r).toMatchObject({ ok: true, anchored: true, anchoredUpTo: 5, anchorRecords: 2 });
        expect(r.ok && r.warnings.join(' ')).toMatch(/2 entries after the last verified anchor are not anchored/);
    });

    it('HEADLINE: whoever holds the signing key rewrites the log, the checkpoints and the anchors, and is still caught by the witness', async () => {
        const k = keys();
        await operator(5, k);                                        // what really happened; the witness has its head
        const { out, witness } = p();
        // The operator now rewrites history: other events, every hash recomputed, signed again with the SAME key, and
        // the anchors file rewritten to match. Everything inside the bundle is consistent.
        const forgedLog = join(dir, 'forged.ndjson');
        const forgedCps = join(dir, 'forged-cps.ndjson');
        const forgedAnchors = join(dir, 'forged-anchors.ndjson');
        const forged = new HashChainAuditSink(forgedLog, { checkpoints: { signer: ed25519Signer(k.privateKey, 'k1'), path: forgedCps } });
        for (let i = 1; i <= 5; i++) forged.write(event(i, i === 3 ? 'erased-the-payment' : undefined));
        forged.checkpoint();
        await anchorAuditLog({ log: forgedLog, anchors: forgedAnchors, anchor: fileAnchor(join(dir, 'operators-own-copy.ndjson')) });
        exportAuditBundle({ log: forgedLog, checkpoints: forgedCps, publicKeys: { k1: k.publicKey }, anchors: forgedAnchors, outDir: out });

        // Offline, with the right key: everything checks out. That is the limit of signatures alone.
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: true });
        // With the witness the auditor holds, it does not.
        const r = await verifyAuditBundleAnchored(out, { trustedKeys: { k1: k.publicKey }, anchors: [fileAnchor(witness)] });
        expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('does not verify') });
    });

    it('a log cut in the tail that no checkpoint signed is detected once it was anchored (the checkpoints alone could not)', async () => {
        const k = keys();
        const { log, cps, anchors, witness, out } = p();
        const sink = new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k.privateKey, 'k1'), path: cps } });
        for (let i = 1; i <= 3; i++) sink.write(event(i));
        sink.checkpoint();                                              // signed up to 3
        for (let i = 4; i <= 6; i++) sink.write(event(i));
        await anchorAuditLog({ log, anchors, anchor: fileAnchor(witness) });   // anchored up to 6, with no signature after 3
        exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k.publicKey }, anchors, outDir: out });
        const file = join(out, 'audit.ndjson');
        writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, 5).join('\n') + '\n');
        const r = verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } });
        expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('anchor 1 covers entry 6, which the log does not have') });
    });

    it('anchor records that disagree with the log fail the offline check too', async () => {
        const k = keys();
        await operator(3, k);
        exportBundle(k);
        const f = join(p().out, 'anchors.ndjson');
        const rec = JSON.parse(readFileSync(f, 'utf8').trim()) as AnchorRecord;
        writeFileSync(f, JSON.stringify({ ...rec, head: 'e'.repeat(64) }) + '\n');
        expect(verifyAuditBundle(p().out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('the log differs from what was anchored') });
    });

    it('records of a kind the verifier did not pass are listed as not verified, and the log is not called anchored', async () => {
        const k = keys();
        await operator(3, k);
        exportBundle(k);
        const r = await verifyAuditBundleAnchored(p().out, { trustedKeys: { k1: k.publicKey }, anchors: [] });
        expect(r).toMatchObject({ ok: true, anchored: false, anchoredUpTo: 0, anchorRecords: 1 });
        expect(r.ok && r.warnings.join(' ')).toMatch(/of a kind you did not pass/);
        expect(r.ok && r.warnings.join(' ')).toMatch(/not anchored outside/);
    });

    it('an anchor that throws while verifying fails the bundle, it does not pass it', async () => {
        const k = keys();
        await operator(3, k);
        exportBundle(k);
        const broken: TimestampAnchor = { kind: 'file', anchor: async () => { throw new Error('unused'); }, verify: async () => { throw new Error('witness unreachable'); } };
        const r = await verifyAuditBundleAnchored(p().out, { trustedKeys: { k1: k.publicKey }, anchors: [broken] });
        expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('witness unreachable') });
    });

    it('a bundle made without anchors still verifies, and says it is not anchored', async () => {
        const k = keys();
        await operator(3, k, []);
        const { log, cps, out } = p();
        const m = exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k.publicKey }, outDir: out });
        expect(m.anchors).toBeUndefined();
        const r = await verifyAuditBundleAnchored(out, { trustedKeys: { k1: k.publicKey }, anchors: [fileAnchor(p().witness)] });
        expect(r).toMatchObject({ ok: true, anchored: false, anchorRecords: 0 });
    });
});
