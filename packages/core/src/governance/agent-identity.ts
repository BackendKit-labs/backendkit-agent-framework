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

    /** The identity of this agent, and whether the call may go on. */
    async check(agentId: string, context: AgentIdentityContext): Promise<IdentityCheck> {
        const { identity, error } = await this.ask(agentId, context);
        if (error) return { ok: false, reason: error };
        if (!this.require) {
            if (!identity && !this.warned.has(agentId)) {
                this.warned.add(agentId);
                this.options.warn?.(`the agent "${agentId}" runs with no digital identity (requireAgentIdentity is off): not suitable for regulated environments`);
            }
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
        return { ok: true, identity };
    }
}
