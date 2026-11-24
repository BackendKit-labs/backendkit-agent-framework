/**
 * The digital identity of an agent (SPEC-0044). An agent that acts carries one, and says on whose behalf it acts: those two are what
 * the framework requires. It does not know any identity provider, credential format or legal framework: an {@link AgentIdentityProvider}
 * (yours, a package's, a provider's adapter) gives each agent its identity, and `core` attributes every call to it.
 *
 * The identity comes from the PROVIDER, never from a credential the agent presents: trusting what a credential says about who the agent is
 * would be circular.
 */

/** Who an agent is, as its provider says. `id` is opaque to the framework: a DID, a URN, an internal id. */
export interface AgentIdentity {
    id: string;
    /** Who vouches for it, when someone does (a provider, a directory, a certificate authority). */
    issuer?: string;
    /** The key this identity signs with. */
    kid?: string;
    /**
     * How well backed the identity is, in the provider's own words. A provider with nobody behind it says `'self-asserted'`, and the audit
     * shows it, so a reader can tell an identity somebody vouched for from one the developer wrote down.
     */
    assurance?: string;
}

import type { AgentProof } from './agent-signature';
import { createPrivateKey, createPublicKey, sign as edSign, type KeyObject } from 'node:crypto';

/** What a provider is told about who is asking, to decide which identity applies. */
export interface AgentIdentityContext {
    sessionId: string;
    tenantId?: string;
    /** On whose behalf the agent acts. */
    userId?: string;
}

export interface AgentIdentityProvider {
    /** The identity of this agent (its profile id), or `undefined` when the provider has none for it. */
    resolve(agentId: string, context: AgentIdentityContext): Promise<AgentIdentity | undefined> | AgentIdentity | undefined;
    /**
     * Signs for the identity of this agent (SPEC-0044 F2): the engine signs every audit event with it, unless `signAuditEvents` is off. Optional
     * and asynchronous on purpose: the key may sit in a KMS, an HSM or the provider's custody, and `core` never holds a private key it was not
     * given. A provider without `sign` only attributes events.
     */
    sign?(agentId: string, message: Uint8Array, context: AgentIdentityContext): Promise<AgentProof> | AgentProof;
}

/** The assurance the reference providers put on every identity: the developer wrote it down, nobody else vouches for it. */
export const SELF_ASSERTED = 'self-asserted';

/**
 * The reference provider, in memory: each agent id maps to its identity. For tests, demos and for whoever uses the framework with no
 * external identity provider. Identities it gives are marked `self-asserted` unless the entry says otherwise.
 */
export function staticAgentIdentities(identities: Record<string, Omit<AgentIdentity, 'assurance'> & { assurance?: string }>): AgentIdentityProvider {
    return {
        resolve(agentId) {
            if (!Object.prototype.hasOwnProperty.call(identities, agentId)) return undefined;
            const found = identities[agentId]!;
            return { ...found, assurance: found.assurance ?? SELF_ASSERTED };
        },
    };
}

/** A one-line identity for every agent: `urn:agent:<agent id>`, marked `self-asserted`. The shortest way to satisfy the requirement. */
export function selfAssertedIdentities(prefix = 'urn:agent:'): AgentIdentityProvider {
    return { resolve: (agentId) => ({ id: `${prefix}${agentId}`, assurance: SELF_ASSERTED }) };
}

export interface IdentityResolverOptions {
    provider?: AgentIdentityProvider;
    /** Default true (SPEC-0044 D8): an agent with no identity, or that does not say on whose behalf it acts, is denied. `false` is for tests. */
    require?: boolean;
    /** How long the provider has to answer before the call is denied. Default 5000. */
    timeoutMs?: number;
    /**
     * How long an answer is reused. Default 5000: an identity revoked at the provider stops being accepted within that time. `0` asks the
     * provider on every call.
     */
    cacheMs?: number;
    /** Called once per agent that runs without an identity because `require` is off. */
    warn?: (message: string) => void;
}

export type IdentityCheck =
    | { ok: true; identity?: AgentIdentity }
    | { ok: false; reason: string };

/** Resolves and checks the identity of the agent behind a call. Fails closed on everything it cannot trust. */
export class IdentityResolver {
    private readonly require: boolean;
    private readonly timeoutMs: number;
    private readonly cacheMs: number;
    private readonly cache = new Map<string, { at: number; answer: { identity?: AgentIdentity; error?: string } }>();
    private readonly warned = new Set<string>();
    private warnedSelfAsserted = false;

    constructor(private readonly options: IdentityResolverOptions) {
        this.require = options.require ?? true;
        this.timeoutMs = options.timeoutMs ?? 5000;
        this.cacheMs = options.cacheMs ?? 5000;
    }

    /** What the last answer was, without asking: for building a principal synchronously. */
    peek(agentId: string): AgentIdentity | undefined {
        return this.cache.get(agentId)?.answer.identity;
    }

    private async ask(agentId: string, context: AgentIdentityContext): Promise<{ identity?: AgentIdentity; error?: string }> {
        const provider = this.options.provider;
        if (!provider) return {};
        const key = `${agentId}\u0000${context.userId ?? ''}\u0000${context.tenantId ?? ''}`;
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < this.cacheMs) return hit.answer;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let answer: { identity?: AgentIdentity; error?: string };
        try {
            const identity = await Promise.race([
                Promise.resolve(provider.resolve(agentId, context)),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${this.timeoutMs} ms`)), this.timeoutMs); }),
            ]);
            if (identity !== undefined && (typeof identity !== 'object' || identity === null || typeof identity.id !== 'string' || identity.id.length === 0)) {
                answer = { error: 'the identity provider returned an identity with no id' };
            } else {
                answer = identity ? { identity } : {};
            }
        } catch (err) {
            // A provider that fails is "no identity AND a failure", never "no identity needed".
            answer = { error: `the identity provider failed: ${err instanceof Error ? err.message : String(err)}` };
        } finally {
            if (timer) clearTimeout(timer);
        }
        // A failure is not remembered: the next call asks again.
        if (!answer.error) { this.cache.set(key, { at: Date.now(), answer }); this.cache.set(agentId, { at: Date.now(), answer }); }
        return answer;
    }

    /**
     * Signs with the identity of this agent, within the same time limit as resolving it. Throws when the provider cannot (no `sign`, it
     * fails, it is too slow or returns something that is not a proof): the caller records the event unsigned and marked.
     */
    async sign(agentId: string, context: AgentIdentityContext, message: Uint8Array): Promise<AgentProof> {
        const provider = this.options.provider;
        if (!provider?.sign) throw new Error('the identity provider cannot sign');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const proof = await Promise.race([
                Promise.resolve(provider.sign(agentId, message, context)),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no signature in ${this.timeoutMs} ms`)), this.timeoutMs); }),
            ]);
            if (!proof || typeof proof !== 'object' || typeof proof.kid !== 'string' || proof.kid.length === 0 || typeof proof.signature !== 'string' || proof.signature.length === 0) {
                throw new Error('the identity provider returned something that is not a proof');
            }
            return proof;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** True when the provider can sign. */
    get canSign(): boolean { return typeof this.options.provider?.sign === 'function'; }

    /**
     * An identity nobody vouches for works, and the audit says so (`assurance: 'self-asserted'`), but whoever starts the agent should hear it too: once per
     * resolver (an engine, a server), not per call and not per agent. Silent under a test runner (`NODE_ENV=test`), where it would be noise on every run.
     */
    private warnIfSelfAsserted(agentId: string, identity: AgentIdentity): void {
        if (this.warnedSelfAsserted || identity.assurance !== SELF_ASSERTED || process.env.NODE_ENV === 'test') return;
        this.warnedSelfAsserted = true;
        this.options.warn?.(`the agent "${agentId}" runs with a self-asserted identity (nobody vouches for who it is): enough to develop, not for a regulated environment or to prove to a third party who acted. Give it an identity provider to change that`);
    }

    /** The identity of this agent, and whether the call may go on. */
    async check(agentId: string, context: AgentIdentityContext): Promise<IdentityCheck> {
        const { identity, error } = await this.ask(agentId, context);
        if (error) return { ok: false, reason: error };
        if (!this.require) {
            if (!identity && !this.warned.has(agentId)) {
                this.warned.add(agentId);
                this.options.warn?.(`the agent "${agentId}" runs with no digital identity (requireAgentIdentity is off): not suitable for regulated environments`);
            }
            if (identity) this.warnIfSelfAsserted(agentId, identity);
            return { ok: true, ...(identity ? { identity } : {}) };
        }
        if (!identity) {
            return {
                ok: false,
                reason: this.options.provider
                    ? `the agent "${agentId}" has no digital identity: the identity provider has none for it`
                    : `the agent "${agentId}" has no digital identity: configure \`agentIdentity\` (for instance \`selfAssertedIdentities()\`), or set \`requireAgentIdentity: false\` for tests only`,
            };
        }
        if (!context.userId) {
            return { ok: false, reason: `the agent "${agentId}" does not say on whose behalf it acts: set \`identity.userId\`` };
        }
        this.warnIfSelfAsserted(agentId, identity);
        return { ok: true, identity };
    }
}

/**
 * The reference provider that SIGNS, in memory: each agent has an Ed25519 key you hold. For tests, demos and for whoever has no external
 * provider but wants signed audit events. The identity is `self-asserted` unless the entry says otherwise. Persist the public keys (`publicKeyOf`)
 * where a verifier can find them: they are what `verifyAuditChain`'s `agentSignatures.keyOf` needs.
 */
export function ed25519AgentIdentities(entries: Record<string, { id: string; privateKey: string | KeyObject; kid?: string; issuer?: string; assurance?: string }>): AgentIdentityProvider & { publicKeyOf(kid: string): KeyObject | undefined } {
    const own = (agentId: string) => (Object.prototype.hasOwnProperty.call(entries, agentId) ? entries[agentId] : undefined);
    const keyOf = (e: NonNullable<ReturnType<typeof own>>): KeyObject => {
        const k = typeof e.privateKey === 'string' ? createPrivateKey(e.privateKey) : e.privateKey;
        if (k.asymmetricKeyType !== 'ed25519') throw new Error('an agent identity key must be Ed25519');
        return k;
    };
    const kidOf = (e: NonNullable<ReturnType<typeof own>>) => e.kid ?? `${e.id}#key-1`;
    for (const e of Object.values(entries)) keyOf(e);   // a wrong key fails when the provider is built, not at the first call
    return {
        resolve(agentId) {
            const e = own(agentId);
            if (!e) return undefined;
            return { id: e.id, kid: kidOf(e), ...(e.issuer ? { issuer: e.issuer } : {}), assurance: e.assurance ?? SELF_ASSERTED };
        },
        sign(agentId, message) {
            const e = own(agentId);
            if (!e) throw new Error(`no key for the agent "${agentId}"`);
            return { kid: kidOf(e), signature: edSign(null, Buffer.from(message), keyOf(e)).toString('base64url'), format: 'ed25519' };
        },
        publicKeyOf(kid) {
            const e = Object.values(entries).find(x => kidOf(x) === kid);
            return e ? createPublicKey(keyOf(e)) : undefined;
        },
    };
}
