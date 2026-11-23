import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson } from '../shared/utils/canonical-json';
import type { AuditEvent, AuditSink } from './types';
import { appendCheckpoint, checkpointMessage, type AuditCheckpoint, type CheckpointSigner } from './audit-checkpoint';
import { agentSignatureProblem, type AgentSignatureCheckOptions } from './agent-signature';

/** Keeps events in memory, in write order. For tests and for in-process inspection. */
export class MemoryAuditSink implements AuditSink {
    readonly events: AuditEvent[] = [];
    write(event: AuditEvent): void { this.events.push(event); }
}

/** One JSON line per event, appended to `path` (directory created on first write). No integrity guarantee. */
export class NdjsonAuditSink implements AuditSink {
    private ready?: Promise<unknown>;
    constructor(private readonly path: string) {}
    async write(event: AuditEvent): Promise<void> {
        this.ready ??= mkdir(dirname(this.path), { recursive: true });
        await this.ready;
        await appendFile(this.path, `${JSON.stringify(event)}\n`);
    }
}

// ── Hash chain ────────────────────────────────────────────────────────────────

/** `prevHash` of the first entry. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * One line of a chained log. `hash` covers `seq`, `prevHash` and the event, so changing, dropping or reordering any
 * line breaks the chain. Same scheme as Steward's governance log.
 */
export interface ChainedAuditEntry {
    seq: number;
    prevHash: string;
    hash: string;
    event: AuditEvent;
    /** HMAC-SHA256 of `hash` with the sink's secret, when it has one. */
    mac?: string;
}

export type ChainVerification =
    | { ok: true; entries: number; head: string; /** With `agentSignatures`: how many events carried a signature that verified. */ signedEvents?: number }
    | { ok: false; entries: number; brokenAt: number; reason: string };

export type SegmentVerification =
    | { ok: true; count: number; last: { seq: number; hash: string } }
    | { ok: false; at: number; reason: string };

const entryHash = (seq: number, prevHash: string, event: AuditEvent): string =>
    createHash('sha256').update(`${seq}\n${prevHash}\n${canonicalJson(event)}`).digest('hex');

const macOf = (secret: string | Uint8Array, hash: string): string =>
    createHmac('sha256', secret).update(`audit:${hash}`).digest('hex');

function macMatches(secret: string | Uint8Array, hash: string, mac: string | undefined): boolean {
    if (typeof mac !== 'string') return false;
    const expected = Buffer.from(macOf(secret, hash), 'hex');
    const given = Buffer.from(mac, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Checks a chained log from its first line. A missing file is an empty, valid log. With `secret`, every entry
 * must also carry a valid MAC: a log rewritten by someone without the secret, every hash recomputed, does not pass.
 */
export function verifyAuditChain(filePath: string, options: { secret?: string | Uint8Array; /** Also check that each event is signed by the identity it names (SPEC-0044 F2). Keys and verifiers come from YOU, never from the log. */ agentSignatures?: AgentSignatureCheckOptions } = {}): ChainVerification {
    if (!existsSync(filePath)) return { ok: true, entries: 0, head: GENESIS_HASH };
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(l => l.length > 0);
    let prev = GENESIS_HASH;
    let signedEvents = 0;
    for (let i = 0; i < lines.length; i++) {
        const seq = i + 1;
        let entry: ChainedAuditEntry;
        try {
            entry = JSON.parse(lines[i]) as ChainedAuditEntry;
        } catch {
            return { ok: false, entries: i, brokenAt: seq, reason: 'line is not valid JSON' };
        }
        if (entry.seq !== seq) return { ok: false, entries: i, brokenAt: seq, reason: `expected seq ${seq}, found ${String(entry.seq)} (a line was removed, added or reordered)` };
        if (entry.prevHash !== prev) return { ok: false, entries: i, brokenAt: seq, reason: 'prevHash does not match the previous entry' };
        if (entry.hash !== entryHash(seq, entry.prevHash, entry.event)) return { ok: false, entries: i, brokenAt: seq, reason: 'hash does not match the content (the entry was modified)' };
        if (options.secret && !macMatches(options.secret, entry.hash, entry.mac)) {
            return { ok: false, entries: i, brokenAt: seq, reason: 'the entry carries no valid MAC for this secret' };
        }
        if (options.agentSignatures) {
            const problem = agentSignatureProblem(entry.event, options.agentSignatures);
            if (problem) return { ok: false, entries: i, brokenAt: seq, reason: `agent signature: ${problem}` };
            if (entry.event.agentSignature) signedEvents++;
        }
        prev = entry.hash;
    }
    return { ok: true, entries: lines.length, head: prev, ...(options.agentSignatures ? { signedEvents } : {}) };
}

/**
 * Checks entries that continue a chain from a known point (`after`: the seq and hash of the entry before the first;
 * `{ seq: 0, hash: GENESIS_HASH }` for a new chain). How a receiver that keeps the head of a log accepts a batch.
 */
export function verifyAuditSegment(entries: readonly ChainedAuditEntry[], after: { seq: number; hash: string }): SegmentVerification {
    let prev = after.hash;
    let seq = after.seq;
    for (const entry of entries) {
        seq += 1;
        if (!entry || typeof entry !== 'object' || typeof entry.hash !== 'string' || typeof entry.prevHash !== 'string' || !entry.event) {
            return { ok: false, at: seq, reason: 'not an audit entry' };
        }
        if (entry.seq !== seq) return { ok: false, at: seq, reason: `expected seq ${seq}, found ${String(entry.seq)}` };
        if (entry.prevHash !== prev) return { ok: false, at: seq, reason: 'prevHash does not match the previous entry' };
        if (entry.hash !== entryHash(seq, entry.prevHash, entry.event)) return { ok: false, at: seq, reason: 'hash does not match the content' };
        prev = entry.hash;
    }
    return { ok: true, count: entries.length, last: { seq, hash: prev } };
}

/** Signed checkpoints of a chained log (SPEC-0042 F1). */
export interface HashChainCheckpointOptions {
    signer: CheckpointSigner;
    /** Where the signed checkpoints are appended. */
    path: string;
    /** Sign automatically every this many entries. Default: only when you call `checkpoint()`. */
    every?: number;
}

/**
 * Append-only audit log where every entry carries the hash of the previous one, so editing, deleting or reordering
 * past entries is detectable with {@link verifyAuditChain}.
 *
 * - Someone who can rewrite the whole file can recompute every hash. Pass a `secret` (kept away from that file's
 *   writers) to add a MAC per entry, and/or store `head` somewhere the writer cannot reach.
 * - One writer per file: two processes appending to the same file would fork the chain.
 * - Writing is synchronous and fsync'd, and errors are thrown: a record that cannot be written is not lost silently.
 * - Opening a file whose chain is already broken throws: a tampered log is not extended.
 * - With `checkpoints`, the sink also signs the `head` (Ed25519) every `every` entries and on demand ({@link checkpoint}),
 *   and appends each signature to its own file. A third party with only the public key can then check the log
 *   (`verifyAuditBundle`, SPEC-0042). The log's own format does not change.
 */
export class HashChainAuditSink implements AuditSink {
    private seq: number;
    private prevHash: string;

    constructor(
        private readonly filePath: string,
        private readonly options: { secret?: string | Uint8Array; checkpoints?: HashChainCheckpointOptions; /** Flush each entry to disk before write returns (default true). Off only where throughput matters more than surviving a machine crash: the last entries may be lost, the chain stays valid up to what reached the disk. */ fsync?: boolean } = {},
    ) {
        const every = options.checkpoints?.every;
        if (every !== undefined && (!Number.isInteger(every) || every < 1)) throw new Error('checkpoints.every must be a positive whole number');
        const check = verifyAuditChain(filePath, options);
        if (!check.ok) {
            throw new Error(`Audit log ${filePath} is not intact at entry ${check.brokenAt}: ${check.reason}. Refusing to append to it.`);
        }
        this.seq = check.entries;
        this.prevHash = check.head;
        mkdirSync(dirname(filePath), { recursive: true });
    }

    /** Hash of the last entry. Store it elsewhere to anchor the log. */
    get head(): string { return this.prevHash; }

    /** Number of entries: the `seq` of the last one. */
    get count(): number { return this.seq; }

    write(event: AuditEvent): void | Promise<void> {
        const seq = this.seq + 1;
        const hash = entryHash(seq, this.prevHash, event);
        const entry: ChainedAuditEntry = {
            seq, prevHash: this.prevHash, hash, event,
            ...(this.options.secret ? { mac: macOf(this.options.secret, hash) } : {}),
        };
        const fd = openSync(this.filePath, 'a');
        try { writeSync(fd, `${JSON.stringify(entry)}\n`); if (this.options.fsync !== false) fsyncSync(fd); } finally { closeSync(fd); }
        this.seq = seq;
        this.prevHash = hash;
        const cp = this.options.checkpoints;
        if (cp?.every !== undefined && seq % cp.every === 0) {
            // A signer in a KMS answers later: the engine awaits this write, so the checkpoint is on disk before the next event.
            const pending = this.signNow();
            if (pending instanceof Promise) return pending.then(() => undefined);
        }
    }

    /**
     * Signs the current head and appends the checkpoint to its file. Returns it, or `undefined` when the sink was built
     * without `checkpoints` or the log is empty (there is nothing to sign). Errors are thrown, like the writes.
     */
    checkpoint(at?: string): AuditCheckpoint | undefined {
        const pending = this.signNow(at);
        if (pending instanceof Promise) {
            pending.catch(() => undefined);
            throw new Error('this checkpoint signer is asynchronous: use checkpointAsync()');
        }
        return pending;
    }

    /** Like {@link checkpoint}, for a signer that may be asynchronous (a KMS, an HSM). Works with a synchronous one too. */
    async checkpointAsync(at?: string): Promise<AuditCheckpoint | undefined> {
        return this.signNow(at);
    }

    /** Signs the head as it is NOW (it can move while an asynchronous signer answers) and appends the checkpoint when the signature is there. */
    private signNow(at: string = new Date().toISOString()): AuditCheckpoint | undefined | Promise<AuditCheckpoint> {
        const cp = this.options.checkpoints;
        if (!cp || this.seq === 0) return undefined;
        const { seq, prevHash: head } = this;
        const sig = cp.signer.sign(checkpointMessage({ seq, head, at, kid: cp.signer.kid }));
        const finish = (signature: string): AuditCheckpoint => {
            const signed: AuditCheckpoint = { seq, head, at, kid: cp.signer.kid, sig: signature };
            appendCheckpoint(cp.path, signed);
            return signed;
        };
        return typeof sig === 'string' ? finish(sig) : sig.then(finish);
    }
}

/**
 * Fans one event out to several sinks, one event at a time in call order (a hash chain needs a stable order, and
 * parallel tool calls finish in any order). A failing sink does not stop the others; the failure is reported.
 */
export class AuditDispatcher {
    private readonly sinks: AuditSink[];
    private queue: Promise<void> = Promise.resolve();

    constructor(sinks: AuditSink | AuditSink[] | undefined, private readonly onError: (err: unknown, sink: AuditSink) => void) {
        this.sinks = sinks === undefined ? [] : Array.isArray(sinks) ? sinks : [sinks];
    }

    get enabled(): boolean { return this.sinks.length > 0; }

    write(event: AuditEvent): Promise<void> {
        if (!this.enabled) return Promise.resolve();
        const run = async () => {
            for (const sink of this.sinks) {
                try { await sink.write(event); } catch (err) { this.onError(err, sink); }
            }
        };
        const next = this.queue.then(run);
        this.queue = next.catch(() => undefined);
        return next;
    }
}
