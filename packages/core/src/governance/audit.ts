import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson } from '../shared/utils/canonical-json';
import type { AuditEvent, AuditSink } from './types';

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
    | { ok: true; entries: number; head: string }
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
export function verifyAuditChain(filePath: string, options: { secret?: string | Uint8Array } = {}): ChainVerification {
    if (!existsSync(filePath)) return { ok: true, entries: 0, head: GENESIS_HASH };
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(l => l.length > 0);
    let prev = GENESIS_HASH;
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
        prev = entry.hash;
    }
    return { ok: true, entries: lines.length, head: prev };
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

/**
 * Append-only audit log where every entry carries the hash of the previous one, so editing, deleting or reordering
 * past entries is detectable with {@link verifyAuditChain}.
 *
 * - Someone who can rewrite the whole file can recompute every hash. Pass a `secret` (kept away from that file's
 *   writers) to add a MAC per entry, and/or store `head` somewhere the writer cannot reach.
 * - One writer per file: two processes appending to the same file would fork the chain.
 * - Writing is synchronous and fsync'd, and errors are thrown: a record that cannot be written is not lost silently.
 * - Opening a file whose chain is already broken throws: a tampered log is not extended.
 */
export class HashChainAuditSink implements AuditSink {
    private seq: number;
    private prevHash: string;

    constructor(private readonly filePath: string, private readonly options: { secret?: string | Uint8Array } = {}) {
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

    write(event: AuditEvent): void {
        const seq = this.seq + 1;
        const hash = entryHash(seq, this.prevHash, event);
        const entry: ChainedAuditEntry = {
            seq, prevHash: this.prevHash, hash, event,
            ...(this.options.secret ? { mac: macOf(this.options.secret, hash) } : {}),
        };
        const fd = openSync(this.filePath, 'a');
        try { writeSync(fd, `${JSON.stringify(entry)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
        this.seq = seq;
        this.prevHash = hash;
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
