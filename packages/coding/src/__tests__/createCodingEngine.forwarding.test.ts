import * as core from '@backendkit-labs/agent-core';

/**
 * createCodingEngine forwards options to createBaseEngine with conditional spreads, which
 * TypeScript does not check for excess properties (the P0 bug of SPEC-0001 §2 dropped
 * onToolApproval that way). Guard the wiring of the options added by ADR-0001 and ADR-0002.
 */
jest.mock('@backendkit-labs/agent-core', () => ({
    ...jest.requireActual('@backendkit-labs/agent-core'),
    createBaseEngine: jest.fn(() => ({})),
    runGlobalSeed: jest.fn(async () => undefined),
}));

import { createCodingEngine } from '../index';

describe('createCodingEngine option forwarding', () => {
    it('forwards maxParallelTools, observability and abortOnBudget to createBaseEngine', () => {
        const observability = { costTracker: { inputPricePerMToken: 3, budget: { perRun: 1 } } };
        createCodingEngine({
            providers: { ollama: {} } as never,
            defaultProvider: 'ollama',
            disablePersistence: true,
            maxParallelTools: 3,
            observability,
            abortOnBudget: true,
        });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call.maxParallelTools).toBe(3);
        expect(call.observability).toBe(observability);
        expect(call.abortOnBudget).toBe(true);
    });

    it('omits them when not set', () => {
        createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        expect(call).not.toHaveProperty('abortOnBudget');
        expect(call).not.toHaveProperty('observability');
        expect(call).not.toHaveProperty('maxParallelTools');
    });
});
