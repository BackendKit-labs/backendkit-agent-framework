/**
 * The signature of an audit event by the digital identity that executed the call (SPEC-0044 F2). The event already names the identity
 * (F1); here the identity also SIGNS it, so a third party can check that this record is what that agent did and that nobody edited it
 * afterwards, even if they rewrote the whole log.
 *
 * The proof is OPAQUE (D12): the provider's `sign` returns `{ kid, signature, format? }` and `core` does not interpret `format`. It checks
 * Ed25519 itself and any other format (a JWS, a qualified electronic seal, an RFC 3161 timestamp...) with the verifier the OPERATOR
 * registers. A format with no verifier does not pass as verified. What legal value a signature has is for the provider and the operator,
 * never for `core`.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '../shared/utils/canonical-json';
import type { AgentIdentity } from './agent-identity';
import type { AuditEvent } from './types';

/** A proof that an identity signed something. `signature` is base64url for `ed25519`; for another format, whatever that format uses. */
export interface AgentProof {
    /** The key that signed. Must be the one of the identity the event names, when that identity names one. */
    kid: string;
    signature: string;
    /** What kind of proof this is. `core` records it and does not interpret it. Default `ed25519`. */
    format?: string;
}

export const ED25519 = 'ed25519';

/** What a verifier of a format is given. Synchronous, like the verification of the log. */
export interface ProofCheck {
    /** The exact bytes that were signed: the SHA-256 of the canonical JSON of the event without its signature. */
    message: Buffer;
    proof: AgentProof;
    identity: AgentIdentity;
}
export type ProofVerifier = (check: ProofCheck) => boolean;

export interface AgentSignatureCheckOptions {
    /**
     * The PUBLIC key of a `kid`, from outside the log: the keys YOU trust, never what the log says about itself. Used for Ed25519 proofs.
     * (A verifier of another format finds its own keys.)
     */
    keyOf?(kid: string, identity: AgentIdentity): KeyObject | string | undefined;
    /** Verifiers of other formats, by the `format` label. Ed25519 needs none. */
    formats?: Record<string, ProofVerifier>;
    /**
     * Accept an event that names an identity and carries no signature (an identity from a provider that does not sign). Default false: with
     * this check on, an event is either signed, or says it had no identity. A signature that could not be made is never accepted.
     */
    allowUnsigned?: boolean;
}

const sha256 = (text: string): Buffer => createHash('sha256').update(text).digest();

/** The bytes an identity signs for an event: everything the event says, except the signature itself. */
export function eventSigningMessage(event: AuditEvent): Buffer {
    const { agentSignature: _s, agentSignatureFailed: _f, ...rest } = event;
    void _s; void _f;
    return sha256(canonicalJson(rest));
}

/**
 * Why this event does not verify, or `undefined` when it does. Checks that the event is signed (or says it had no identity), that the
 * signature is by the key of the identity it names, and that the proof verifies: Ed25519 here, any other format with the verifier registered.
 */
export function agentSignatureProblem(event: AuditEvent, options: AgentSignatureCheckOptions): string | undefined {
    const proof = event.agentSignature;
    if (!proof) {
        if (event.agentSignatureFailed) return 'the identity could not sign this event';
        if (event.agentIdentityMissing) return undefined;
        if (event.agentIdentity && options.allowUnsigned) return undefined;
        return 'the event is neither signed nor marked as having no identity';
    }
    const identity = event.agentIdentity;
    if (!identity) return 'signed, but names no identity';
    if (typeof proof.kid !== 'string' || typeof proof.signature !== 'string') return 'the signature is malformed';
    if (identity.kid !== undefined && identity.kid !== proof.kid) return 'signed by a key that is not the one of the identity it names';
    const format = proof.format ?? ED25519;
    const message = eventSigningMessage(event);
    if (format === ED25519) {
        const raw = options.keyOf?.(proof.kid, identity);
        if (!raw) return `no trusted public key for "${proof.kid}"`;
        let ok = false;
        try {
            const key = typeof raw === 'string' ? createPublicKey(raw) : raw.type === 'private' ? createPublicKey(raw) : raw;
            ok = edVerify(null, message, key, Buffer.from(proof.signature, 'base64url'));
        } catch { ok = false; }
        return ok ? undefined : 'the signature does not verify';
    }
    // Own property only: a format called "constructor" or "toString" is not a verifier.
    const verifier = options.formats && Object.prototype.hasOwnProperty.call(options.formats, format) ? options.formats[format] : undefined;
    if (!verifier) return `no verifier is registered for the proof format "${format}": it is recorded, not verified`;
    let ok = false;
    try { ok = verifier({ message, proof, identity }) === true; } catch { ok = false; }
    return ok ? undefined : `the proof of format "${format}" does not verify`;
}
