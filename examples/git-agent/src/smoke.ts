/**
 * Live smoke test. Needs LLM_API_KEY (+ LLM_BASE_URL / LLM_MODEL) and talks to the real API.
 * It only touches a throwaway repository created under the OS temp dir, and registers the
 * read-only tools, so it cannot modify anything.
 *
 *   LLM_API_KEY=... LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-v4-flash npm run smoke
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CallbackTransport, type AgentEvent } from '@backendkit-labs/agent-core';
import { createGitEngine } from './engine';
import { loadConfig } from './config';
import { repoReport } from './report';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'git-agent-smoke-'));
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 'smoke@example.com');
    sh(dir, 'config', 'user.name', 'Smoke Test');
    for (const [file, msg] of [['a.txt', 'feat: add alpha file'], ['b.txt', 'fix: handle empty beta'], ['c.txt', 'chore: tidy gamma']]) {
        writeFileSync(join(dir, file), `${msg}\n`);
        sh(dir, 'add', file);
        sh(dir, 'commit', '-q', '-m', msg);
    }
    writeFileSync(join(dir, 'wip.txt'), 'uncommitted\n');
    return dir;
}

function recorder() {
    const events: AgentEvent[] = [];
    return { events, transport: new CallbackTransport((e) => { events.push(e); }) };
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
async function check(name: string, fn: () => Promise<string>) {
    try { results.push({ name, ok: true, detail: await fn() }); }
    catch (err) { results.push({ name, ok: false, detail: (err as Error).message }); }
}

async function main() {
    const repo = makeRepo();
    const base = loadConfig();
    try {
        await check('agent run: delegates to the inspector, calls git_log, reports usage', async () => {
            const { events, transport } = recorder();
            const engine = createGitEngine(transport, { readOnly: true, config: base });
            await engine.run(`Show the last 3 commits of the repository at "${repo}". Use that exact path.`);
            const tools = events.filter((e) => e.type === 'tool_call').map((e) => (e as { name: string }).name);
            const errors = events.filter((e) => e.type === 'error');
            const text = events.filter((e) => e.type === 'token').map((e) => (e as { content: string }).content).join('');
            const metrics = events.filter((e) => e.type === 'metrics');
            if (errors.length) throw new Error('error event: ' + JSON.stringify(errors[0]));
            if (!tools.includes('git_log')) throw new Error(`git_log not called; tools=${tools.join(',')}`);
            if (!/alpha|beta|gamma/.test(text)) throw new Error('answer does not mention the commits: ' + text.slice(0, 120));
            if (!metrics.length) throw new Error('no metrics events');
            return `tools=${[...new Set(tools)].join(',')} metrics=${metrics.length}`;
        });

        await check('/report: typed, validated repository report', async () => {
            const { transport } = recorder();
            const engine = createGitEngine(transport, { readOnly: true, config: base });
            const report = await repoReport(engine, repo);
            if (report.uncommittedChanges < 1) throw new Error('should see the uncommitted wip.txt: ' + JSON.stringify(report));
            return `health=${report.health} uncommitted=${report.uncommittedChanges} branches=${report.branches.map((b) => b.name).join(',')}`;
        });

        await check('budget cap: stops the run and emits budget_exceeded', async () => {
            const { events, transport } = recorder();
            const capped = { ...base, budgetUsd: 0.000001, priceInPerM: base.priceInPerM ?? 1, priceOutPerM: base.priceOutPerM ?? 1 };
            const engine = createGitEngine(transport, { readOnly: true, config: capped });
            await engine.run(`Show the last 3 commits of the repository at "${repo}". Use that exact path.`);
            const exceeded = events.filter((e) => e.type === 'budget_exceeded');
            if (exceeded.length !== 1) throw new Error(`expected 1 budget_exceeded, got ${exceeded.length}`);
            return `cost=$${engine.observability?.getRunCost().toFixed(6)}`;
        });
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }

    let failed = 0;
    for (const r of results) {
        if (!r.ok) failed++;
        console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}\n     ${r.detail}`);
    }
    console.log(`\n${results.length - failed}/${results.length} OK`);
    process.exit(failed ? 1 : 0);
}

main();
