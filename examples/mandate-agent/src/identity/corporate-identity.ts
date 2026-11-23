/**
 * A SECOND identity provider, to show that the design does not depend on eIDAS 2: a company's own IAM with its keys in a KMS. Different
 * identifiers (a URN, not a DID), a different issuer and a different custody, behind the same `AgentIdentityProvider`. A stand-in for tests.
 */
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import type { AgentIdentity, AgentIdentityProvider } from './prototype';

export class CorporateIdentity {
    readonly issuer = 'urn:acme:iam';
    private readonly keys = new Map<string, { identity: AgentIdentity; privateKey: KeyObject; publicKey: KeyObject }>();

    register(agentId: string): AgentIdentity {
        const known = this.keys.get(agentId);
        if (known) return known.identity;
        const pair = generateKeyPairSync('ed25519');
        const identity: AgentIdentity = { id: `urn:acme:agent:${agentId}`, issuer: this.issuer, kid: `acme-kms/${agentId}/v1` };
        this.keys.set(agentId, { identity, privateKey: pair.privateKey, publicKey: pair.publicKey });
        return identity;
    }

    publicKeyOfKid(kid: string): KeyObject | undefined {
        for (const k of this.keys.values()) if (k.identity.kid === kid) return k.publicKey;
        return undefined;
    }

    provider(): AgentIdentityProvider {
        return {
            resolve: async (agentId) => { await pause(); return this.keys.get(agentId)?.identity; },
            sign: async (agentId, message) => {
                await pause();   // a KMS answers in milliseconds, not synchronously
                const k = this.keys.get(agentId);
                if (!k) throw new Error(`the KMS holds no key for "${agentId}"`);
                return { kid: k.identity.kid!, signature: edSign(null, Buffer.from(message), k.privateKey).toString('base64url') };
            },
        };
    }
}

const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 3));
