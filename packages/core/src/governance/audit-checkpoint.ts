/**
 * A signed checkpoint of the audit log (SPEC-0042 F1). A leaf module (it imports nothing of the audit log) so the sink
 * can use it and the bundle can check it without a cycle.
 *
 * The hash chain already makes the log tamper-evident to whoever kept an earlier `head`. A checkpoint signs the `head`
 * at a point of the log with an Ed25519 key, so whoever has only the PUBLIC key can check that the log up to that point is
 * the one the key's owner vouched for.
 */
import { createPrivateKey, createPublicKey, sign as edSign, type KeyObject } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** The head of the log at a point, signed. `at` is the signer's clock: it says when it signed, not more. */
export interface AuditCheckpoint {
    /** Number of entries the checkpoint covers: the `seq` of the last one. */
    seq: number;
    /** The `hash` of that entry. */
    head: string;
    /** ISO time. */
    at: string;
    /** Names the key that signed, so keys can be rotated and the old ones kept for verifying. */
    kid: string;
    /** Ed25519 signature, base64url, over {@link checkpointMessage}. */
    sig: string;
}

/** What is signed. A fixed text, so the signature cannot be moved to another purpose or another log position. */
export const checkpointMessage = (c: Pick<AuditCheckpoint, 'seq' | 'head' | 'at' | 'kid'>): Buffer =>
    Buffer.from(`bk-audit-checkpoint/1\n${c.seq}\n${c.head}\n${c.at}\n${c.kid}`, 'utf8');

/** Signs checkpoints. Synchronous, like the sink that calls it: a key in a file or in memory. */
export interface CheckpointSigner {
    readonly kid: string;
    sign(message: Buffer): string;
}

export type KeyInput = string | KeyObject;
export const asPrivateKey = (k: KeyInput): KeyObject => (typeof k === 'string' ? createPrivateKey(k) : k);
export const asPublicKey = (k: KeyInput): KeyObject => (typeof k === 'string' ? createPublicKey(k) : k.type === 'private' ? createPublicKey(k) : k);

/** A signer with an Ed25519 private key (PEM text or a `KeyObject`). Other key types are refused. */
export function ed25519Signer(privateKey: KeyInput, kid: string): CheckpointSigner {
    const key = asPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('the checkpoint signing key must be Ed25519');
    if (!kid) throw new Error('a checkpoint signer needs a kid');
    return { kid, sign: (message) => edSign(null, message, key).toString('base64url') };
}

export function signCheckpoint(signer: CheckpointSigner, seq: number, head: string, at: string = new Date().toISOString()): AuditCheckpoint {
    return { seq, head, at, kid: signer.kid, sig: signer.sign(checkpointMessage({ seq, head, at, kid: signer.kid })) };
}

/** Appends a checkpoint to its file (one JSON line, fsync'd; the directory is created if missing). */
export function appendCheckpoint(path: string, checkpoint: AuditCheckpoint): void {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'a');
    try { writeSync(fd, `${JSON.stringify(checkpoint)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}

export function readCheckpoints(path: string): AuditCheckpoint[] {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(l => l.length > 0).map(l => JSON.parse(l) as AuditCheckpoint);
}
