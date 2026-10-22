/**
 * Offline checks of the git tools (no LLM, no network). Everything runs inside a throwaway repository.
 *
 *   npm run check
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ToolDefinition } from '@backendkit-labs/agent-core';
import {
    gitStatus, gitLog, gitShow, gitCheckout, gitCommit, gitRebase, gitBranch, gitAdd, READ_ONLY_GIT_TOOLS, ALL_GIT_TOOLS,
} from './tools/git-tools';

const run = (tool: ToolDefinition, args: Record<string, unknown>) => tool.execute(args, {} as never);
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

const dir = mkdtempSync(join(tmpdir(), 'git-agent-check-'));
const canary = join(dir, 'PWNED');

const checks: Array<[string, () => Promise<void>]> = [
    ['values are never interpreted by a shell (author / grep / path)', async () => {
        for (const evil of [`x"; touch "${canary}"; echo "`, `$(touch ${canary})`, `\`touch ${canary}\``, `x & echo > ${canary}`]) {
            await run(gitLog, { cwd: dir, author: evil, grep: evil, path: evil, count: 5 });
            assert.equal(existsSync(canary), false, `shell ran for: ${evil}`);
        }
    }],
    ['refs that look like options are rejected, not passed to git', async () => {
        await assert.rejects(run(gitShow, { cwd: dir, ref: `--output=${canary}` }), /must not start with "-"/);
        await assert.rejects(run(gitCheckout, { cwd: dir, target: '--orphan=x' }), /must not start with "-"/);
        assert.equal(existsSync(canary), false);
    }],
    ['a required value that is missing fails clearly instead of running git with "undefined"', async () => {
        await assert.rejects(run(gitRebase, { cwd: dir }), /onto is required/);
        await assert.rejects(run(gitBranch, { cwd: dir, action: 'create' }), /name is required/);
    }],
    ['commit messages with quotes and shell characters are stored verbatim', async () => {
        const message = `fix: handle "quoted" $HOME and \`ticks\` & more`;
        writeFileSync(join(dir, 'f.txt'), 'x\n');
        await run(gitAdd, { cwd: dir, files: ['f.txt'] });
        await run(gitCommit, { cwd: dir, message });
        assert.equal(sh(dir, 'log', '-1', '--format=%s').trim(), message);
    }],
    ['results reported on stderr (checkout) are no longer lost', async () => {
        const out = await run(gitCheckout, { cwd: dir, target: 'feat/x', create: true });
        assert.match(out, /Switched to a new branch/);
    }],
    ['concurrent read-only calls do not collide on the index lock', async () => {
        const results = await Promise.all(Array.from({ length: 6 }, () => run(gitStatus, { cwd: dir })));
        for (const r of results) assert.doesNotMatch(r, /index\.lock|Error:/);
    }],
    ['outside a repository the tool returns the git error as text', async () => {
        const outside = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
        try { assert.match(await run(gitStatus, { cwd: outside }), /^Error: .*not a git repository/i); }
        finally { rmSync(outside, { recursive: true, force: true }); }
    }],
    ['the read-only set contains only read tools', async () => {
        const names = READ_ONLY_GIT_TOOLS.map((t) => t.name).sort();
        assert.deepEqual(names, ['git_blame', 'git_diff', 'git_log', 'git_reflog', 'git_show', 'git_status']);
        assert.ok(ALL_GIT_TOOLS.length > READ_ONLY_GIT_TOOLS.length);
    }],
];

async function main() {
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 'check@example.com');
    sh(dir, 'config', 'user.name', 'Check');
    writeFileSync(join(dir, 'seed.txt'), 'seed\n');
    sh(dir, 'add', 'seed.txt');
    sh(dir, 'commit', '-q', '-m', 'chore: seed');

    let failed = 0;
    for (const [name, fn] of checks) {
        try { await fn(); console.log(`OK   ${name}`); }
        catch (err) { failed++; console.log(`FAIL ${name}\n     ${(err as Error).message.split('\n')[0]}`); }
    }
    rmSync(dir, { recursive: true, force: true });
    console.log(`\n${checks.length - failed}/${checks.length} OK`);
    process.exit(failed ? 1 : 0);
}

main();
