/**
 * Signed checkpoints and bundles of the audit log (SPEC-0042 F1). The first block (F0) fixes what a third party cannot
 * do today; the rest is what the checkpoints and the bundle add, and where they stop.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashChainAuditSink, verifyAuditChain } from '../audit';
import { appendCheckpoint, ed25519Signer, readCheckpoints, signCheckpoint } from '../audit-checkpoint';
import { exportAuditBundle, verifyAuditBundle } from '../audit-bundle';
import type { AuditEvent } from '../types';

const event = (n: number, tool = `tool-${n}`): AuditEvent => ({
    at: `2026-11-21T10:00:0${n % 10}.000Z`, principal: { agentId: 'main', sessionId: 's', chain: ['main'] },
    tool, argsHash: 'a'.repeat(64), decision: 'allow', outcome: 'ok', durationMs: 1,
} as AuditEvent);

const keys = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { publicKey, privateKey }; };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'audit-bundle-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const paths = () => ({ log: join(dir, 'audit.ndjson'), cps: join(dir, 'checkpoints.ndjson'), out: join(dir, 'bundle') });

function writeLog(n: number, k: { privateKey: KeyObject }, kid = 'k1', every?: number, secret?: string) {
    const { log, cps } = paths();
    const sink = new HashChainAuditSink(log, {
        ...(secret ? { secret } : {}),
        checkpoints: { signer: ed25519Signer(k.privateKey, kid), path: cps, ...(every ? { every } : {}) },
    });
    for (let i = 1; i <= n; i++) sink.write(event(i));
    return sink;
}

describe('F0: what a third party cannot do with a log that has no checkpoints', () => {
    it('a log with a MAC, rewritten whole by someone without the secret, passes the chain check unless you hold the secret', () => {
        const { log } = paths();
        const sink = new HashChainAuditSink(log, { secret: 'operator-secret' });
        for (let i = 1; i <= 3; i++) sink.write(event(i));
        // The attacker rewrites the log with other events, recomputing every hash, with no secret (so no MAC).
        const forged = join(dir, 'forged.ndjson');
        const attacker = new HashChainAuditSink(forged);
        for (let i = 1; i <= 3; i++) attacker.write(event(i, 'something-else'));
        copyFileSync(forged, log);
        expect(verifyAuditChain(log).ok).toBe(true);                                  // a third party without the secret is fooled
        expect(verifyAuditChain(log, { secret: 'operator-secret' }).ok).toBe(false);  // only the secret's holder can tell
    });

    it('cutting the tail of a log leaves it valid: only someone who kept the head can tell', () => {
        const { log } = paths();
        const sink = new HashChainAuditSink(log);
        for (let i = 1; i <= 4; i++) sink.write(event(i));
        const kept = sink.head;
        writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(0, 2).join('\n') + '\n');
        const after = verifyAuditChain(log);
        expect(after).toMatchObject({ ok: true, entries: 2 });
        expect(after.ok && after.head).not.toBe(kept);
    });
});

describe('checkpoints written by the sink', () => {
    it('signs every N entries and on demand, in its own file, without changing the log', () => {
        const k = keys();
        const sink = writeLog(7, k, 'k1', 3);
        const { log, cps } = paths();
        expect(readCheckpoints(cps).map(c => c.seq)).toEqual([3, 6]);
        const manual = sink.checkpoint();
        expect(manual).toMatchObject({ seq: 7, head: sink.head, kid: 'k1' });
        expect(readCheckpoints(cps).map(c => c.seq)).toEqual([3, 6, 7]);
        expect(verifyAuditChain(log)).toMatchObject({ ok: true, entries: 7 });
    });

    it('does nothing without a signer or on an empty log, and refuses a bad `every`', () => {
        const { log, cps } = paths();
        expect(new HashChainAuditSink(log).checkpoint()).toBeUndefined();
        const k = keys();
        expect(new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k.privateKey, 'k1'), path: cps } }).checkpoint()).toBeUndefined();
        expect(() => new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k.privateKey, 'k1'), path: cps, every: 0 } })).toThrow(/positive whole number/);
    });

    it('only Ed25519 keys sign, and a signer has a kid', () => {
        const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        expect(() => ed25519Signer(rsa, 'k1')).toThrow(/Ed25519/);
        expect(() => ed25519Signer(keys().privateKey, '')).toThrow(/kid/);
    });
});

describe('a bundle checked with the keys the verifier trusts', () => {
    function exported(n = 7, every = 3, extra: (sink: HashChainAuditSink) => void = s => { s.checkpoint(); }) {
        const k = keys();
        const sink = writeLog(n, k, 'k1', every);
        extra(sink);
        const { log, cps, out } = paths();
        exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k.publicKey }, outDir: out });
        return { k, out };
    }

    it('passes: the chain and every signature check out, without any secret of the operator', () => {
        const { k, out } = exported();
        const r = verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } });
        expect(r).toMatchObject({ ok: true, entries: 7, checkpoints: 3, signedUpTo: 7, unsignedTail: 0, keySource: 'verifier', anchored: false });
        expect(r.ok && r.warnings.join(' ')).toMatch(/not anchored/);
    });

    it('with only the keys inside the bundle, it passes but says the keys were not yours', () => {
        const { out } = exported();
        const r = verifyAuditBundle(out);
        expect(r).toMatchObject({ ok: true, keySource: 'bundle' });
        expect(r.ok && r.warnings.join(' ')).toMatch(/keys inside the bundle/);
    });

    it('entries after the last checkpoint are reported as not covered', () => {
        const { k, out } = exported(7, 3, () => undefined);   // checkpoints at 3 and 6; entry 7 is unsigned
        const r = verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } });
        expect(r).toMatchObject({ ok: true, signedUpTo: 6, unsignedTail: 1 });
        expect(r.ok && r.warnings.join(' ')).toMatch(/1 entries after the last checkpoint/);
    });

    it('a bundle with no checkpoints only has its chain checked, and says so', () => {
        const { log, cps, out } = paths();
        const sink = new HashChainAuditSink(log);
        sink.write(event(1));
        exportAuditBundle({ log, checkpoints: cps, publicKeys: {}, outDir: out });
        const r = verifyAuditBundle(out);
        expect(r).toMatchObject({ ok: true, checkpoints: 0, signedUpTo: 0, unsignedTail: 1 });
        expect(r.ok && r.warnings.join(' ')).toMatch(/no checkpoints/);
    });

    it('an entry changed inside the covered range breaks the chain', () => {
        const { k, out } = exported();
        const file = join(out, 'audit.ndjson');
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        lines[1] = lines[1]!.replace('tool-2', 'tool-X');
        writeFileSync(file, lines.join('\n') + '\n');
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, at: 2, reason: expect.stringContaining('not intact') });
    });

    it('a log rewritten whole with every hash recomputed no longer matches what was signed', () => {
        const { k, out } = exported();
        const forged = join(dir, 'forged.ndjson');
        const attacker = new HashChainAuditSink(forged);
        for (let i = 1; i <= 7; i++) attacker.write(event(i, i === 2 ? 'tool-X' : undefined));
        copyFileSync(forged, join(out, 'audit.ndjson'));
        expect(verifyAuditChain(join(out, 'audit.ndjson')).ok).toBe(true);        // the chain alone cannot tell
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('differs from what was signed') });
    });

    it('a log cut before a checkpoint is detected, because the checkpoint names an entry that is gone', () => {
        const { k, out } = exported();
        const file = join(out, 'audit.ndjson');
        writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, 4).join('\n') + '\n');
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('the log was cut') });
    });

    it('LIMIT: entries after the last checkpoint can be cut without it being noticed', () => {
        const { k, out } = exported(7, 3, () => undefined);
        const file = join(out, 'audit.ndjson');
        writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, 6).join('\n') + '\n');
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: true, entries: 6, unsignedTail: 0 });
    });

    it('a checkpoint edited after signing does not verify', () => {
        const { k, out } = exported();
        const file = join(out, 'checkpoints.ndjson');
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        const cp = JSON.parse(lines[0]!) as { seq: number };
        lines[0] = JSON.stringify({ ...cp, seq: 2 });
        writeFileSync(file, lines.join('\n') + '\n');
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, at: 1, reason: expect.stringContaining('signature that does not verify') });
    });

    it('checkpoints out of order or repeated do not pass', () => {
        const { k, out } = exported();
        const file = join(out, 'checkpoints.ndjson');
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        writeFileSync(file, [lines[1], lines[0], lines[2]].join('\n') + '\n');
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('does not go forward') });
    });

    it('a key the verifier does not trust is refused, even if the bundle carries it', () => {
        const { out } = exported();
        const other = keys();
        expect(verifyAuditBundle(out, { trustedKeys: { k1: other.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('does not verify') });
        expect(verifyAuditBundle(out, { trustedKeys: { other: other.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('not one of the trusted keys') });
    });

    it('a forger who rewrites the log and signs it with their own key passes against the bundle keys, but not against yours', () => {
        const real = keys();
        const forger = keys();
        const forgedLog = join(dir, 'forged.ndjson');
        const forgedCps = join(dir, 'forged-cps.ndjson');
        const sink = new HashChainAuditSink(forgedLog, { checkpoints: { signer: ed25519Signer(forger.privateKey, 'k1'), path: forgedCps, every: 3 } });
        for (let i = 1; i <= 6; i++) sink.write(event(i, 'forged'));
        const out = join(dir, 'forged-bundle');
        exportAuditBundle({ log: forgedLog, checkpoints: forgedCps, publicKeys: { k1: forger.publicKey }, outDir: out });
        expect(verifyAuditBundle(out)).toMatchObject({ ok: true, keySource: 'bundle' });                         // honest about what it proves
        expect(verifyAuditBundle(out, { trustedKeys: { k1: real.publicKey } })).toMatchObject({ ok: false });    // the key you hold decides
    });

    it('keys can rotate: checkpoints of both keys verify when the verifier holds both', () => {
        const k1 = keys();
        const k2 = keys();
        const { log, cps, out } = paths();
        const first = new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k1.privateKey, 'k1'), path: cps } });
        for (let i = 1; i <= 3; i++) first.write(event(i));
        first.checkpoint();
        const second = new HashChainAuditSink(log, { checkpoints: { signer: ed25519Signer(k2.privateKey, 'k2'), path: cps } });
        for (let i = 4; i <= 6; i++) second.write(event(i));
        second.checkpoint();
        exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k1.publicKey, k2: k2.publicKey }, outDir: out });
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k1.publicKey, k2: k2.publicKey } })).toMatchObject({ ok: true, checkpoints: 2, signedUpTo: 6 });
        expect(verifyAuditBundle(out, { trustedKeys: { k2: k2.publicKey } })).toMatchObject({ ok: false, reason: expect.stringContaining('"k1"') });
    });

    it('a log kept with a MAC still verifies without the secret: the bundle needs none', () => {
        const k = keys();
        const sink = writeLog(4, k, 'k1', undefined, 'operator-secret');
        sink.checkpoint();
        const { log, cps, out } = paths();
        exportAuditBundle({ log, checkpoints: cps, publicKeys: { k1: k.publicKey }, outDir: out });
        expect(verifyAuditBundle(out, { trustedKeys: { k1: k.publicKey } })).toMatchObject({ ok: true, entries: 4 });
    });

    it('a broken log is not exported, and a missing or malformed bundle is not ok', () => {
        const k = keys();
        writeLog(3, k);
        const { log, cps, out } = paths();
        const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
        writeFileSync(log, [lines[0], lines[2]].join('\n') + '\n');
        expect(() => exportAuditBundle({ log, checkpoints: cps, publicKeys: {}, outDir: out })).toThrow(/not intact/);
        expect(verifyAuditBundle(join(dir, 'nowhere'))).toMatchObject({ ok: false, reason: expect.stringContaining('no audit.ndjson') });
    });

    it('a checkpoint signed for one purpose cannot be reused as another: the message is fixed and carries the position', () => {
        const k = keys();
        const signer = ed25519Signer(k.privateKey, 'k1');
        const a = signCheckpoint(signer, 3, 'h'.repeat(64), '2026-11-21T10:00:00.000Z');
        const b = signCheckpoint(signer, 4, 'h'.repeat(64), '2026-11-21T10:00:00.000Z');
        expect(a.sig).not.toBe(b.sig);
        appendCheckpoint(join(dir, 'x.ndjson'), a);
        expect(readCheckpoints(join(dir, 'x.ndjson'))).toEqual([a]);
    });
});

describe('HashChainAuditSink fsync option', () => {
    it('with fsync off the log is written and still verifies', () => {
        const dir = mkdtempSync(join(tmpdir(), 'chain-nosync-'));
        try {
            const file = join(dir, 'a.ndjson');
            const sink = new HashChainAuditSink(file, { fsync: false });
            sink.write({ type: 'tool_call' } as never);
            sink.write({ type: 'tool_call' } as never);
            expect(verifyAuditChain(file)).toMatchObject({ ok: true, entries: 2 });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('bundle manifest', () => {
    it('a manifest that does not describe the log is warned about, and export copies exactly what it describes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bundle-manifest-'));
        try {
            const log = join(dir, 'a.ndjson');
            const sink = new HashChainAuditSink(log);
            for (let i = 0; i < 3; i++) sink.write({ type: 'tool_call' } as never);
            const out = join(dir, 'out');
            const m = exportAuditBundle({ log, checkpoints: join(dir, 'none.ndjson'), publicKeys: {}, outDir: out });
            expect(m.entries).toBe(3);
            expect(verifyAuditBundle(out)).toMatchObject({ ok: true, entries: 3 });
            writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...m, entries: 9 }));
            const r = verifyAuditBundle(out);
            expect(r).toMatchObject({ ok: true });
            expect((r as { warnings: string[] }).warnings.some(w => /manifest\.json says 9 entries/.test(w))).toBe(true);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
