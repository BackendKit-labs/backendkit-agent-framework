import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@backendkit-labs/agent-core';

/** SPEC-0017 F6b: orchestration turns the learning module on, and the Reflection Engine (deprecated) stays off. */
jest.mock('@backendkit-labs/agent-core', () => ({
    ...jest.requireActual('@backendkit-labs/agent-core'),
    createBaseEngine: jest.fn(() => ({})),
}));
jest.mock('../cli/bootstrap/GlobalSeed', () => ({ runGlobalSeed: jest.fn(async () => undefined) }));

import { createCodingEngine } from '../index';

let home: string;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-learning-home-'));
    process.env.USERPROFILE = home;
    process.env.HOME = home;
});
afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
});

const build = (orchestration: unknown) => {
    createCodingEngine({ providers: { ollama: {} } as never, defaultProvider: 'ollama', disablePersistence: true, orchestration: orchestration as never });
    return (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
};

describe('createCodingEngine learning', () => {
    it('passes the learning module to the engine when orchestration is on', () => {
        const call = build(true);
        expect(call.learning).toBeDefined();
    });

    it('uses the instance the caller created', () => {
        const learning = core.createLearning();
        const call = build({ learning });
        expect(call.learning).toBe(learning);
    });

    it('learning: false leaves it out', () => {
        const call = build({ learning: false });
        expect(call.learning).toBeUndefined();
    });

    it('does nothing without orchestration', () => {
        const call = build(undefined);
        expect(call.learning).toBeUndefined();
    });
});
