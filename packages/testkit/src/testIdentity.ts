import { selfAssertedIdentities, type AgentIdentityProvider, type Identity } from '@backendkit-labs/agent-core';

/**
 * What an agent needs to act since SPEC-0044: a digital identity and a person to act for. Spread it into the engine of a test:
 * `createBaseEngine({ ...testIdentity(), providers, ... })`. The identity is self-asserted and marked as such in the audit.
 */
export function testIdentity(userId = 'test-user'): { agentIdentity: AgentIdentityProvider; identity: Identity } {
    return { agentIdentity: selfAssertedIdentities('urn:test:agent:'), identity: { userId } };
}
