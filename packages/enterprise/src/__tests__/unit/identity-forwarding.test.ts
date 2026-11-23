/**
 * createEnterpriseSetup forwards the identity options to createBaseEngine with conditional spreads, which TypeScript does not check for excess
 * properties: guard the wiring (SPEC-0044). The engine of a web session acts for the person the server authenticated.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@backendkit-labs/agent-core';

jest.mock('@backendkit-labs/agent-core', () => ({
    ...jest.requireActual('@backendkit-labs/agent-core'),
    createBaseEngine: jest.fn(() => ({ setIterationMode: () => undefined })),
}));

import { createEnterpriseSetup } from '../../factory';

describe('enterprise engineFactory and identity', () => {
    let work: string;
    beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'ent-identity-')); });
    afterEach(() => rmSync(work, { recursive: true, force: true }));

    const setup = (extra: Record<string, unknown> = {}) => createEnterpriseSetup({
        vaultPath: join(work, 'vault'), providers: new core.ProviderRegistry(), defaultProvider: 'main',
        indexDir: join(work, 'idx'), sessionsDir: join(work, 'sessions'), ...extra,
    });
    const lastCall = () => (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
    const transport = { emit: () => undefined, close: () => undefined } as never;

    it('forwards agentIdentity, identity and the opt-out from the setup options', () => {
        const agentIdentity = core.selfAssertedIdentities();
        setup({ agentIdentity, identity: { userId: 'ops', tenantId: 't1' }, requireAgentIdentity: false }).engineFactory('s1', transport);
        expect(lastCall()).toMatchObject({ agentIdentity, identity: { userId: 'ops', tenantId: 't1' }, requireAgentIdentity: false });
    });

    it('the person the server authenticated is who the engine acts for, over the fixed one, and keeps the rest of the identity', () => {
        setup({ agentIdentity: core.selfAssertedIdentities(), identity: { userId: 'ops', tenantId: 't1' } }).engineFactory('s1', transport, { userId: 'u-42' });
        expect(lastCall().identity).toEqual({ userId: 'u-42', tenantId: 't1' });
    });

    it('with no fixed identity, the authenticated person alone is enough', () => {
        setup({ agentIdentity: core.selfAssertedIdentities() }).engineFactory('s1', transport, { userId: 'u-42' });
        expect(lastCall().identity).toEqual({ userId: 'u-42' });
    });

    it('with neither, no identity is invented', () => {
        setup({ agentIdentity: core.selfAssertedIdentities() }).engineFactory('s1', transport);
        expect(lastCall().identity).toBeUndefined();
    });
});
