/**
 * Bundles of the audit log (SPEC-0042 F1): evidence a third party can check without the operator's secret. The signed
 * checkpoints they hold are in `audit-checkpoint.ts`.
 *
 * The hash chain already makes the log tamper-evident to whoever kept an earlier `head`. A checkpoint signs the `head`
 * at a point of the log with an Ed25519 key, so whoever has only the PUBLIC key can check that the log up to that point is
 * the one the key's owner vouched for, and that nothing before it was changed, dropped or reordered since.
 *
 * What it does not do: whoever holds the private key can rewrite the whole log and sign it again. What stops that is an
 * anchor outside their reach (a sealed timestamp, a `head` published elsewhere): see `audit-anchor.ts`. Without a verified
 * anchor a bundle is tamper-evident, not proof, and {@link verifyAuditBundle} says so; {@link verifyAuditBundleAnchored}
 * checks the anchors against the places the VERIFIER trusts.
 */
import { verify as edVerify, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENESIS_HASH, verifyAuditChain, type ChainedAuditEntry } from './audit';
import { asPublicKey, checkpointMessage, readCheckpoints, type AuditCheckpoint, type KeyInput } from './audit-checkpoint';
import { readAnchors, type AnchorRecord, type TimestampAnchor } from './audit-anchor';

// ── Bundle ────────────────────────────────────────────────────────────────────

export const BUNDLE_FORMAT = 'bk-audit-bundle/1';

export interface BundleManifest {
    format: typeof BUNDLE_FORMAT;
    createdAt: string;
    entries: number;
    head: string;
    checkpoints: number;
    /** Anchor records in the bundle (`anchors.ndjson`). Absent in bundles made before anchors existed. */
    anchors?: number;
}

/**
 * Writes a bundle in `outDir`: `audit.ndjson` (the chained log), `checkpoints.ndjson`, `keys.json` (the PUBLIC keys by
 * `kid`, for convenience: a verifier must not trust them, see {@link verifyAuditBundle}) and `manifest.json`. With
 * `anchors` (the file `anchorAuditLog` writes) it also copies `anchors.ndjson`.
 */
export function exportAuditBundle(options: {
    log: string; checkpoints: string; publicKeys: Record<string, KeyInput>; outDir: string; anchors?: string; now?: () => Date;
}): BundleManifest {
    const chain = verifyAuditChain(options.log);
    if (!chain.ok) throw new Error(`the log is not intact at entry ${chain.brokenAt}: ${chain.reason}. A broken log is not exported.`);
    mkdirSync(options.outDir, { recursive: true });
    const log = existsSync(options.log) ? readFileSync(options.log, 'utf8') : '';
    const checkpoints = existsSync(options.checkpoints) ? readFileSync(options.checkpoints, 'utf8') : '';
    const anchors = options.anchors && existsSync(options.anchors) ? readFileSync(options.anchors, 'utf8') : '';
    const keys: Record<string, string> = {};
    for (const [kid, k] of Object.entries(options.publicKeys)) keys[kid] = asPublicKey(k).export({ type: 'spki', format: 'pem' }).toString();
    const manifest: BundleManifest = {
        format: BUNDLE_FORMAT, createdAt: (options.now?.() ?? new Date()).toISOString(), entries: chain.entries, head: chain.head,
        checkpoints: checkpoints.split('\n').filter(l => l.length > 0).length,
        ...(anchors ? { anchors: anchors.split('\n').filter(l => l.length > 0).length } : {}),
    };
    writeFileSync(join(options.outDir, 'audit.ndjson'), log);
    writeFileSync(join(options.outDir, 'checkpoints.ndjson'), checkpoints);
    if (anchors) writeFileSync(join(options.outDir, 'anchors.ndjson'), anchors);
    writeFileSync(join(options.outDir, 'keys.json'), `${JSON.stringify(keys, null, 2)}\n`);
    writeFileSync(join(options.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

export type BundleVerification =
    | {
        ok: true;
        entries: number;
        head: string;
        checkpoints: number;
        /** The last entry a valid signature covers. 0 when there is no checkpoint. */
        signedUpTo: number;
        /** Entries after the last checkpoint: nothing signed vouches for them yet. */
        unsignedTail: number;
        /** `verifier`: the keys the verifier passed. `bundle`: the ones in the bundle, which prove integrity under THAT key, not who owns it. */
        keySource: 'verifier' | 'bundle';
        /** True only when {@link verifyAuditBundleAnchored} checked an anchor outside the operator's reach and it held. */
        anchored: boolean;
        /** The last entry a verified anchor covers. Changing anything up to it is detectable even by whoever holds the signing key. 0 when none. */
        anchoredUpTo: number;
        /** Anchor records found in the bundle, verified or not. */
        anchorRecords: number;
        warnings: string[];
    }
    | { ok: false; reason: string; at?: number };

/**
 * Checks a bundle offline, with no secret of the operator: the chain, then each checkpoint (its signature with the key of
 * its `kid`, that it names a real entry with that hash, and that they go forward in order).
 *
 * `trustedKeys` are the public keys YOU hold, from outside the bundle. Without them the bundle's own `keys.json` is used,
 * and the result says `keySource: 'bundle'`: whoever forged the bundle can include their own key, so then a valid
 * signature only shows the log is consistent with the key it carries.
 */
export function verifyAuditBundle(dir: string, options: { trustedKeys?: Record<string, KeyInput> } = {}): BundleVerification {
    const file = (name: string): string => join(dir, name);
    for (const name of ['audit.ndjson', 'checkpoints.ndjson', 'keys.json', 'manifest.json']) {
        if (!existsSync(file(name))) return { ok: false, reason: `the bundle has no ${name}` };
    }
    let manifest: BundleManifest;
    let bundleKeys: Record<string, string>;
    try {
        manifest = JSON.parse(readFileSync(file('manifest.json'), 'utf8')) as BundleManifest;
        bundleKeys = JSON.parse(readFileSync(file('keys.json'), 'utf8')) as Record<string, string>;
    } catch {
        return { ok: false, reason: 'manifest.json or keys.json is not valid JSON' };
    }
    if (manifest.format !== BUNDLE_FORMAT) return { ok: false, reason: `unknown bundle format "${String(manifest.format)}"` };

    const chain = verifyAuditChain(file('audit.ndjson'));
    if (!chain.ok) return { ok: false, reason: `the log is not intact at entry ${chain.brokenAt}: ${chain.reason}`, at: chain.brokenAt };

    let checkpoints: AuditCheckpoint[];
    try { checkpoints = readCheckpoints(file('checkpoints.ndjson')); } catch { return { ok: false, reason: 'checkpoints.ndjson has a line that is not valid JSON' }; }

    const hashes = new Map<number, string>();
    hashes.set(0, GENESIS_HASH);
    readFileSync(file('audit.ndjson'), 'utf8').split('\n').filter(l => l.length > 0)
        .forEach(l => { const e = JSON.parse(l) as ChainedAuditEntry; hashes.set(e.seq, e.hash); });

    const keySource: 'verifier' | 'bundle' = options.trustedKeys ? 'verifier' : 'bundle';
    const keys: Record<string, KeyInput> = options.trustedKeys ?? bundleKeys;
    let lastSeq = 0;
    let lastAt = '';
    for (let i = 0; i < checkpoints.length; i++) {
        const c = checkpoints[i]!;
        const n = i + 1;
        if (!c || typeof c.seq !== 'number' || typeof c.head !== 'string' || typeof c.at !== 'string' || typeof c.kid !== 'string' || typeof c.sig !== 'string') {
            return { ok: false, reason: `checkpoint ${n} is malformed`, at: n };
        }
        if (!Object.prototype.hasOwnProperty.call(keys, c.kid)) return { ok: false, reason: `checkpoint ${n} was signed with the key "${c.kid}", which is not one of the ${keySource === 'verifier' ? 'trusted' : 'bundle'} keys`, at: n };
        let publicKey: KeyObject;
        try { publicKey = asPublicKey(keys[c.kid]!); } catch { return { ok: false, reason: `the key "${c.kid}" is not a usable public key`, at: n }; }
        if (publicKey.asymmetricKeyType !== 'ed25519') return { ok: false, reason: `the key "${c.kid}" is not Ed25519`, at: n };
        let valid = false;
        try { valid = edVerify(null, checkpointMessage(c), publicKey, Buffer.from(c.sig, 'base64url')); } catch { valid = false; }
        if (!valid) return { ok: false, reason: `checkpoint ${n} has a signature that does not verify`, at: n };
        if (!hashes.has(c.seq) || c.seq < 1) return { ok: false, reason: `checkpoint ${n} covers entry ${c.seq}, which the log does not have (the log was cut)`, at: n };
        if (hashes.get(c.seq) !== c.head) return { ok: false, reason: `checkpoint ${n} signs a head that is not the hash of entry ${c.seq} (the log differs from what was signed)`, at: n };
        if (c.seq <= lastSeq) return { ok: false, reason: `checkpoint ${n} does not go forward (entry ${c.seq} after ${lastSeq})`, at: n };
        if (c.at < lastAt) return { ok: false, reason: `checkpoint ${n} is dated before the previous one`, at: n };
        lastSeq = c.seq;
        lastAt = c.at;
    }

    // The anchor records of the bundle are the operator's copy: they must at least agree with the log. Whether the anchors
    // really exist where they say is what verifyAuditBundleAnchored checks, with the verifier's own anchors.
    const records = anchorProblem(file('anchors.ndjson'), hashes);
    if (typeof records === 'string') return { ok: false, reason: records };

    const warnings: string[] = [];
    if (checkpoints.length === 0) warnings.push('the bundle has no checkpoints: only the hash chain was checked');
    if (keySource === 'bundle' && checkpoints.length > 0) warnings.push('checked against the keys inside the bundle: pass the public keys you trust (trustedKeys) to know who signed');
    if (chain.entries > lastSeq) warnings.push(`${chain.entries - lastSeq} entries after the last checkpoint are not covered by any signature`);
    if (records.length > 0) warnings.push(`${records.length} anchor records are in the bundle but were not verified: use verifyAuditBundleAnchored with the anchors you trust`);
    warnings.push('not anchored outside the operator\'s reach: whoever holds the signing key could have rewritten and signed the whole log');
    return {
        ok: true, entries: chain.entries, head: chain.head, checkpoints: checkpoints.length, signedUpTo: lastSeq,
        unsignedTail: chain.entries - lastSeq, keySource, anchored: false, anchoredUpTo: 0, anchorRecords: records.length, warnings,
    };
}

/** Reads the anchor records of a bundle and checks them against the log: well formed, in order, each naming a real entry with that hash. */
function anchorProblem(path: string, hashes: Map<number, string>): AnchorRecord[] | string {
    let records: AnchorRecord[];
    try { records = readAnchors(path); } catch { return 'anchors.ndjson has a line that is not valid JSON'; }
    let lastSeq = 0;
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        const n = i + 1;
        if (!r || typeof r.seq !== 'number' || typeof r.head !== 'string' || typeof r.kind !== 'string' || typeof r.at !== 'string') return `anchor ${n} is malformed`;
        if (!hashes.has(r.seq) || r.seq < 1) return `anchor ${n} covers entry ${r.seq}, which the log does not have (the log was cut after it was anchored)`;
        if (hashes.get(r.seq) !== r.head) return `anchor ${n} names a head that is not the hash of entry ${r.seq} (the log differs from what was anchored)`;
        if (r.seq < lastSeq) return `anchor ${n} goes backwards (entry ${r.seq} after ${lastSeq})`;
        lastSeq = r.seq;
    }
    return records;
}

/**
 * {@link verifyAuditBundle}, plus the anchors: each anchor record is checked by the anchor of its `kind` that YOU pass (built
 * to look at the place you trust, for example the witness file of the auditor), never by what the record says. A record that
 * does not verify fails the bundle. Records of a kind you did not pass are listed as not verified.
 *
 * When an anchor holds, `anchored` is true and `anchoredUpTo` is the last entry it covers: changing anything up to there is
 * detectable even by whoever holds the signing key and rewrote the log, the checkpoints and the keys.
 */
export async function verifyAuditBundleAnchored(
    dir: string, options: { trustedKeys?: Record<string, KeyInput>; anchors: TimestampAnchor[] },
): Promise<BundleVerification> {
    const base = verifyAuditBundle(dir, options.trustedKeys ? { trustedKeys: options.trustedKeys } : {});
    if (!base.ok) return base;
    const records = readAnchors(join(dir, 'anchors.ndjson'));
    const warnings = base.warnings.filter(w => !w.includes('were not verified') && !w.startsWith('not anchored'));
    let anchoredUpTo = 0;
    let unchecked = 0;
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        const anchor = options.anchors.find(a => a.kind === r.kind);
        if (!anchor) { unchecked += 1; continue; }
        let verdict;
        try { verdict = await anchor.verify(r); } catch (err) { verdict = { ok: false as const, reason: `the anchor failed: ${err instanceof Error ? err.message : String(err)}` }; }
        if (!verdict.ok) return { ok: false, reason: `anchor ${i + 1} (${r.kind}) does not verify: ${verdict.reason}`, at: i + 1 };
        anchoredUpTo = Math.max(anchoredUpTo, r.seq);
    }
    if (unchecked > 0) warnings.push(`${unchecked} anchor records are of a kind you did not pass, so they were not verified`);
    if (anchoredUpTo === 0) warnings.push('not anchored outside the operator\'s reach: whoever holds the signing key could have rewritten and signed the whole log');
    else if (base.entries > anchoredUpTo) warnings.push(`${base.entries - anchoredUpTo} entries after the last verified anchor are not anchored`);
    return { ...base, anchored: anchoredUpTo > 0, anchoredUpTo, anchorRecords: records.length, warnings };
}
