/**
 * Several identity providers behind ONE `MandateVerifier`. The framework is not tied to a provider: an agent holds a credential issued by
 * whoever its operator chose, and the engine only ever sees a verifier. When an operator works with more than one provider (a company
 * identity system for some agents, a wallet for others, eIDAS 2 for a third group), this picks which provider's verifier reads a credential.
 *
 * It routes on the `iss` of the credential, READ WITHOUT VERIFYING. That is safe because it only chooses who judges the credential: the
 * chosen verifier checks the signature against the keys IT trusts for that issuer, and a credential that claims an issuer whose key it was
 * not signed with is refused there. Nothing the router read is used as a fact about the credential.
 *
 * Fail closed: no credential, an unreadable one, or an issuer with no route is a refusal.
 */
import { parseJws } from '@backendkit-labs/agent-mandates';
import type { MandateRequest, MandateVerification, MandateVerifier } from '@backendkit-labs/agent-core';

export interface RouterOptions {
    /** The credential this agent holds for this call, from any provider. */
    credentialFor(request: MandateRequest): string | undefined | Promise<string | undefined>;
    /** Issuer (as it appears in `iss`) → the verifier of the provider that issues under that name. */
    routes: Record<string, MandateVerifier>;
}

const deny = (reason: string): MandateVerification => ({ ok: false, reason });

export function routeByIssuer(options: RouterOptions): MandateVerifier {
    return {
        async verify(request: MandateRequest): Promise<MandateVerification> {
            let credential: string | undefined;
            try { credential = await options.credentialFor(request); } catch (err) { return deny(`the credential could not be read: ${err instanceof Error ? err.message : String(err)}`); }
            if (!credential) return deny('this agent holds no power of representation');

            const parsed = parseJws(credential.split('~')[0]!);
            if (!parsed.ok) return deny(`the credential is malformed: ${parsed.reason}`);
            const issuer = parsed.jws.payload.iss;
            if (typeof issuer !== 'string' || issuer.length === 0) return deny('the credential has no issuer (iss)');
            if (!Object.prototype.hasOwnProperty.call(options.routes, issuer)) return deny(`no identity provider is configured for the issuer "${issuer}"`);
            return options.routes[issuer]!.verify(request);
        },
    };
}
