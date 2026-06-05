#!/usr/bin/env node
/**
 * Instala deps y corre tsc --noEmit en cada test-project.
 * Usa concurrencia limitada para no saturar npm.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR  = path.join(__dirname, '..', 'test-projects');
const CONCURRENCY = 4;

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SPIN = '\x1b[33m…\x1b[0m';

if (!fs.existsSync(TEST_DIR)) {
    console.error('No test-projects/ found. Run generate-test-projects.mjs first.');
    process.exit(1);
}

const projects = fs.readdirSync(TEST_DIR).filter(d =>
    fs.statSync(path.join(TEST_DIR, d)).isDirectory()
);

const results = [];

function run(name) {
    const dir = path.join(TEST_DIR, name);
    process.stdout.write(`  ${SPIN} ${name.padEnd(28)} installing…\r`);
    try {
        execSync('npm install --prefer-offline --no-audit --no-fund', {
            cwd: dir, stdio: 'pipe', timeout: 120_000,
        });
        process.stdout.write(`  ${SPIN} ${name.padEnd(28)} typechecking…\r`);
        execSync('npx tsc --noEmit', {
            cwd: dir, stdio: 'pipe', timeout: 60_000,
        });
        console.log(`  ${PASS} ${name}`);
        results.push({ name, ok: true });
    } catch (err) {
        const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
        const firstError = output.split('\n').find(l => l.includes('error TS')) ?? output.slice(0, 200);
        console.log(`  ${FAIL} ${name}`);
        console.log(`       ${firstError.trim()}`);
        results.push({ name, ok: false, error: firstError.trim() });
    }
}

// Run in batches of CONCURRENCY
for (let i = 0; i < projects.length; i += CONCURRENCY) {
    const batch = projects.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(p => Promise.resolve().then(() => run(p))));
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;

console.log(`\n  ${passed}/${results.length} passed${failed ? `  (${failed} failed)` : ''}\n`);
if (failed > 0) process.exit(1);
