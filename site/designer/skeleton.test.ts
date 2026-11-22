/**
 * The skeleton is real code (SPEC-0040 F0): each design's skeleton is compiled with the TypeScript compiler against the
 * packages of this repository, so a change in the API of the framework breaks THIS test and not the visitor. Then the
 * tests the skeleton generated are run, with the stubs of the tools answering: that is the design's own rules, run by the real
 * engine, producing the outcomes the design claims.
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateDesign } from './validate.ts';
import { renderSkeleton } from './render.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the repository so the generated code finds the workspace packages in node_modules, as a project of the visitor would.
const outRoot = join(here, '.out');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const TSCONFIG = {
    compilerOptions: {
        target: 'ES2022', module: 'commonjs', moduleResolution: 'node', ignoreDeprecations: '5.0', lib: ['ES2022'],
        outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true, esModuleInterop: true, types: ['node'],
    },
    include: ['src/**/*'],
};

/** A test run started from inside a test run would otherwise talk to its parent instead of printing. */
function childEnv(): NodeJS.ProcessEnv { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; }

const FIXTURES = ['refunds', 'support-triage', 'report-readonly', 'invoice-reconciliation', 'injection'];

after(() => { rmSync(outRoot, { recursive: true, force: true }); });

function generate(name: string): string {
    const v = validateDesign(JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')));
    assert.ok(v.ok, `${name} should be valid`);
    const dir = join(outRoot, name);
    rmSync(dir, { recursive: true, force: true });
    // stubs answer, so the tests the skeleton generated can run end to end
    for (const f of renderSkeleton(v.spec, { stubs: 'echo' })) {
        const target = join(dir, f.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, f.content);
    }
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'generated', private: true, type: 'commonjs' }));
    return dir;
}

describe('the skeleton of each design compiles against the real packages and its own tests pass', () => {
    for (const name of FIXTURES) {
        test(name, { timeout: 180_000 }, () => {
            const dir = generate(name);

            const compiled = spawnSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' });
            assert.equal(compiled.status, 0, `tsc failed:\n${compiled.stdout}${compiled.stderr}`);

            const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(dir, 'dist', 'agent.test.js')], { encoding: 'utf8', cwd: dir, env: childEnv() });
            assert.equal(ran.status, 0, `the generated tests failed:\n${ran.stdout}${ran.stderr}`);
            assert.match(ran.stdout, /# fail 0/);
            assert.doesNotMatch(ran.stdout, /# pass 0\b/, 'no generated test ran');
        });
    }

    test('an unfinished tool (stubs that throw) still compiles, and its tests of refusals still pass', { timeout: 120_000 }, () => {
        const v = validateDesign(JSON.parse(readFileSync(join(here, 'fixtures', 'refunds.json'), 'utf8')));
        assert.ok(v.ok);
        const dir = join(outRoot, 'refunds-throwing');
        rmSync(dir, { recursive: true, force: true });
        for (const f of renderSkeleton(v.spec)) {
            const target = join(dir, f.path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, f.content);
        }
        writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'generated', private: true, type: 'commonjs' }));
        const compiled = spawnSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, `tsc failed:\n${compiled.stdout}${compiled.stderr}`);
        // The refusal tests do not need the tool; the ones that expect a tool to run fail until it is written, as the generated comment says.
        const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', 'waits-for-finance', join(dir, 'dist', 'agent.test.js')], { encoding: 'utf8', cwd: dir, env: childEnv() });
        assert.equal(ran.status, 0, `the refusal test failed:\n${ran.stdout}${ran.stderr}`);
    });
});
