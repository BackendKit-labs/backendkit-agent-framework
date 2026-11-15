import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { BkProjectInfo } from '../detector';
import { addPackageDevDependency, addPackageScript } from '../patcher';
import { GENERATED_DEP_RANGES } from '../../scaffold';

const DEV_DEPS: Array<[string, string]> = [
    ['@backendkit-labs/agent-testkit', GENERATED_DEP_RANGES['@backendkit-labs/agent-testkit']],
    ['jest', '^29.0.0'],
    ['ts-jest', '^29.0.0'],
    ['@types/jest', '^29.0.0'],
];

const JEST_CONFIG = `/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
};
`;

export const EXAMPLE_TEST = `import { createBaseEngine } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider } from '@backendkit-labs/agent-testkit';

// Test an agent without an API key. This example builds its own small engine; to test your project's agent,
// export a factory from src/engine.ts that accepts a provider and pass the doubles below instead.
//
// More doubles in @backendkit-labs/agent-testkit:
//   - startMockLlmServer(...)  a fake OpenAI-compatible server that returns 429s, resets, overflows...
//   - RecordingProvider / ReplayProvider  record a real run once, replay it in every test run
//   - world.fileEquals / untouched / processGone  check what the agent really did to the system

const agent = {
    id: 'helper', name: 'Helper', icon: '🤖', description: 'example agent',
    systemPrompt: 'Answer briefly.', allowedTools: [], delegatesTo: [],
};

describe('an agent tested without an API key', () => {
    it('answers from a scripted provider', async () => {
        const t = mockTransport();
        const engine = createBaseEngine({
            providers: { mock: scriptedProvider([{ content: 'Hello from the script' }]) },
            defaultProvider: 'mock', agents: [agent], defaultAgent: 'helper',
            transport: t.transport, workingDir: process.cwd(), iterationMode: 'auto',
        });

        await engine.run('hi');

        expect(t.text()).toBe('Hello from the script');
        expect(t.eventsOf('error')).toEqual([]);
    });
});
`;

/** \`add testing\`: dev dependencies, a jest config, a \`test\` script and an example test. Never overwrites files. */
export function addTesting(info: BkProjectInfo, _args: string[], opts: { install?: boolean } = {}): void {
    const install = opts.install ?? true;

    let added = false;
    for (const [name, range] of DEV_DEPS) added = addPackageDevDependency(info.pkgFile, name, range) || added;
    addPackageScript(info.pkgFile, 'test', 'jest');

    const written: string[] = [];
    const write = (rel: string, content: string) => {
        const target = path.join(info.cwd, rel);
        if (fs.existsSync(target)) return;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        written.push(rel);
    };
    if (!fs.existsSync(path.join(info.cwd, 'jest.config.js')) && !fs.existsSync(path.join(info.cwd, 'jest.config.ts'))) {
        write('jest.config.js', JEST_CONFIG);
    }
    write(path.join('src', '__tests__', 'agent.example.test.ts'), EXAMPLE_TEST);

    if (added && install) {
        console.log('\n  Installing test dependencies...');
        execSync('npm install', { cwd: info.cwd, stdio: 'inherit' });
    }

    console.log('\n  ✅ Testing set up.\n');
    for (const f of written) console.log(`     created ${f}`);
    console.log('     run: npm test\n');
}
