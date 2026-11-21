/**
 * Anchors for the audit log (SPEC-0042 F2): putting the `head` somewhere the operator cannot rewrite.
 *
 * A signed checkpoint (F1) shows the log is the one the key's owner vouched for. It does not stop that owner from
 * rewriting the whole log and signing it again. An anchor does: it records `(seq, head)` OUTSIDE the operator's reach (a
 * file on another host, a sealed timestamp, a commit in a repository they do not control). From then on, changing any
 * entry up to `seq` is detectable by someone who checks the anchor, even if the log, the checkpoints and the keys are
 * all rewritten.
 *
 * What counts is where the anchor lives, not this code: an anchor written to a file the operator can edit anchors
 * nothing. The framework ships the interface and a file anchor; a sealed timestamp (RFC 3161) is an implementation of
 * the same interface for when someone needs it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { verifyAuditChain } from './audit';

/** The head of the log at a point, put somewhere outside the operator's reach. */
export interface AnchorRecord {
    /** Number of entries the anchor covers: the `seq` of the last one. */
    seq: number;
    /** The `hash` of that entry. */
    head: string;
    /** Names the kind of anchor, so the verifier knows which implementation checks it. */
    kind: string;
    /** When it was anchored, as the anchor reported it. An independent clock only if the anchor has one. */
    at: string;
    /** Where it lives (a path, a URL, a commit). Informational: the verifier checks with ITS OWN anchor, not this. */
    ref?: string;
    /** What the anchor returned (a receipt, a sealed token). Opaque to the framework. */
    proof?: string;
}

export type AnchorVerification = { ok: true; at?: string } | { ok: false; reason: string };

/** Puts a head outside the operator's reach, and checks that it is there. Asynchronous: it may go over a network. */
export interface TimestampAnchor {
    readonly kind: string;
    /** Anchors the head. The record it returns must carry the same `seq` and `head`. */
    anchor(point: { seq: number; head: string }): Promise<AnchorRecord>;
    /**
     * Checks that `(seq, head)` of the record is anchored where this implementation looks. A verifier builds the anchor
     * pointing at ITS copy (the witness file it trusts), never at what the record says.
     */
    verify(record: AnchorRecord): Promise<AnchorVerification>;
}

export function readAnchors(path: string): AnchorRecord[] {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(l => l.length > 0).map(l => JSON.parse(l) as AnchorRecord);
}

function appendAnchor(path: string, record: AnchorRecord): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/**
 * Anchors the current head of a chained log and records what the anchor returned in `anchors` (a file next to the
 * log, which goes into the bundle). Call it when it matters: at the end of the day, before an export. If the head is
 * already the last one anchored, it returns that record and writes nothing. A log that is empty or not intact is not anchored.
 */
export async function anchorAuditLog(options: { log: string; anchors: string; anchor: TimestampAnchor }): Promise<AnchorRecord> {
    const chain = verifyAuditChain(options.log);
    if (!chain.ok) throw new Error(`the log is not intact at entry ${chain.brokenAt}: ${chain.reason}. A broken log is not anchored.`);
    if (chain.entries === 0) throw new Error('the log is empty: there is nothing to anchor');
    const last = readAnchors(options.anchors).filter(r => r.kind === options.anchor.kind).pop();
    if (last && last.seq === chain.entries && last.head === chain.head) return last;
    const record = await options.anchor.anchor({ seq: chain.entries, head: chain.head });
    if (!record || record.seq !== chain.entries || record.head !== chain.head || record.kind !== options.anchor.kind) {
        throw new Error(`the ${options.anchor.kind} anchor returned a record for another point than the one asked: it is not recorded`);
    }
    appendAnchor(options.anchors, record);
    return record;
}

/**
 * Anchors by appending `{ seq, head, at }` to a file. It anchors something only if that file is OUT of the operator's
 * reach: on a host or a mount they cannot write (a witness, a machine of the auditor, a write-once volume). On a file the
 * operator can edit, it is a record, not an anchor. To verify, build it with the path of the copy you trust.
 */
export function fileAnchor(path: string, options: { now?: () => Date } = {}): TimestampAnchor {
    const kind = 'file';
    return {
        kind,
        async anchor({ seq, head }) {
            const at = (options.now?.() ?? new Date()).toISOString();
            appendAnchor(path, { seq, head, kind, at });
            return { seq, head, kind, at, ref: path };
        },
        async verify(record) {
            if (!existsSync(path)) return { ok: false, reason: `the witness file ${path} does not exist` };
            const found = readFileSync(path, 'utf8').split('\n').filter(l => l.length > 0).some(l => {
                try { const r = JSON.parse(l) as { seq?: number; head?: string }; return r.seq === record.seq && r.head === record.head; } catch { return false; }
            });
            return found ? { ok: true } : { ok: false, reason: `the witness file has no record of entry ${record.seq} with that head` };
        },
    };
}
