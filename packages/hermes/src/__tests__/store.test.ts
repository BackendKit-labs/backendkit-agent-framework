import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { InProcessConnector, JsonRunStore, type RunRecord } from '../index';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hermes-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const rec = (runId: string, extra: Partial<RunRecord> = {}): RunRecord => ({
    runId, agentId: 'a', capability: 'c', inputPreview: '{}', status: 'running', principalId: 'p', startedAt: new Date(Number(runId.replace(/\D/g, '')) * 1000).toISOString(), ...extra,
});

describe('JsonRunStore', () => {
    it('survives a restart and leaves no temp file behind', async () => {
        const file = join(dir, 'nested', 'runs.json');
        const first = new JsonRunStore(file);
        await first.put(rec('r1'));
        await first.update('r1', { status: 'done', output: 'ok' });
        expect(readdirSync(join(dir, 'nested'))).toEqual(['runs.json']);

        const second = new JsonRunStore(file);
        expect(second.get('r1')).toMatchObject({ status: 'done', output: 'ok' });
    });

    it('many writes at once all land, in order, and the file stays valid JSON', async () => {
        const file = join(dir, 'runs.json');
        const store = new JsonRunStore(file);
        await Promise.all(Array.from({ length: 40 }, (_, i) => store.put(rec(`r${i}`))));
        await store.flush();
        expect(JSON.parse(readFileSync(file, 'utf8')).runs).toHaveLength(40);
    });

    it('lists by agent and status; an unknown run cannot be updated', async () => {
        const store = new JsonRunStore(undefined);
        await store.put(rec('r1'));
        await store.put(rec('r2', { agentId: 'b', status: 'done' }));
        expect(store.list({ agentId: 'b' }).map(r => r.runId)).toEqual(['r2']);
        expect(store.list({ status: ['running'] }).map(r => r.runId)).toEqual(['r1']);
        expect(await store.update('ghost', { status: 'done' })).toBeUndefined();
    });

    it('when full it drops the oldest finished runs and never a running one', async () => {
        const store = new JsonRunStore(undefined, 3);
        await store.put(rec('r1', { status: 'running' }));
        await store.put(rec('r2', { status: 'done' }));
        await store.put(rec('r3', { status: 'done' }));
        await store.put(rec('r4', { status: 'done' }));
        expect(store.list().map(r => r.runId).sort()).toEqual(['r1', 'r3', 'r4']);
    });

    it('without a file it keeps runs in memory only', async () => {
        const store = new JsonRunStore(undefined);
        await store.put(rec('r1'));
        expect(existsSync(join(dir, 'runs.json'))).toBe(false);
        expect(store.get('r1')).toBeDefined();
    });
});

describe('InProcessConnector', () => {
    const connector = () => new InProcessConnector({
        name: 'w',
        capabilities: {
            ok: { handler: async i => i },
            boom: { handler: async () => { throw new Error('kaput'); } },
            hang: { async: true, handler: (_i, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) },
        },
    });

    it('a throwing handler is a failed run, not a rejection', async () => {
        const handle = await connector().run({ capability: 'boom', input: {} });
        expect(await handle.result()).toEqual({ status: 'failed', error: 'kaput' });
    });

    it('cancel aborts the handler and the run ends cancelled', async () => {
        const handle = await connector().run({ capability: 'hang', input: {} });
        expect(await handle.status()).toBe('running');
        await handle.cancel();
        expect(await handle.result()).toMatchObject({ status: 'cancelled' });
    });

    it('an unknown capability or an unavailable agent refuses to start', async () => {
        const c = connector();
        await expect(c.run({ capability: 'nope', input: {} })).rejects.toMatchObject({ code: 'CAPABILITY_NOT_FOUND' });
        c.setAvailable(false);
        expect(await c.health()).toMatchObject({ state: 'down' });
        await expect(c.run({ capability: 'ok', input: {} })).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
    });

    it('close stops what is still running', async () => {
        const c = connector();
        const handle = await c.run({ capability: 'hang', input: {} });
        await c.close();
        expect((await handle.result()).status).toBe('cancelled');
    });
});

describe('bk-hermes validate', () => {
    const cli = join(__dirname, '..', '..', 'dist', 'bin', 'bk-hermes.js');
    const runCli = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

    (existsSync(cli) ? it : it.skip)('exits 0 for a good file and 1 with the path of the error for a bad one', () => {
        const good = join(dir, 'good.yaml');
        const bad = join(dir, 'bad.yaml');
        require('node:fs').writeFileSync(good, 'fleet: f\nagents:\n  - { id: a, connector: { kind: protocol, url: "http://localhost:1" } }\n');
        require('node:fs').writeFileSync(bad, 'fleet: f\nagents:\n  - { id: a, connector: { kind: protocol, url: nope } }\n');
        expect(runCli('validate', good)).toMatchObject({ status: 0, stdout: expect.stringContaining('1 agent') });
        const failed = runCli('validate', bad);
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain('agents.0.connector.url');
        expect(runCli('validate', join(dir, 'missing.yaml')).status).toBe(1);
        expect(runCli().status).toBe(0);
    });

    (existsSync(cli) ? it : it.skip)('warns on stderr about a budget nothing enforces, and still exits 0 with the ok line on stdout (ADR-0007)', () => {
        const file = join(dir, 'budget.yaml');
        require('node:fs').writeFileSync(file, [
            'fleet: f',
            'agents:',
            '  - { id: a, connector: { kind: protocol, url: "http://localhost:1" }, limits: { budgetUsdPerDay: 5, maxConcurrent: 2 } }',
            'policies:',
            '  budget: { perDayUsd: 20 }',
            '',
        ].join('\n'));
        const out = runCli('validate', file);
        expect(out.status).toBe(0);
        expect(out.stdout).toContain('ok: fleet "f"');
        expect(out.stdout).not.toContain('warning');
        expect(out.stderr).toContain('warning: agents.a.limits.budgetUsdPerDay');
        expect(out.stderr).toContain('warning: policies.budget.perDayUsd');
        expect(out.stderr).not.toContain('maxConcurrent'); // enforced, so nothing to warn about
    });

    (existsSync(cli) ? it : it.skip)('also checks the fleet as it will be once presets are merged', () => {
        const fs = require('node:fs');
        const mod = join(__dirname, 'fixtures', 'preset-module.js').split(String.fromCharCode(92)).join('/');
        const ok = join(dir, 'with-preset.yaml');
        fs.writeFileSync(ok, `fleet: f
agents:
  - { id: a, connector: { kind: in-process } }
presets:
  - { module: "${mod}", options: { word: hi } }
`);
        expect(runCli('validate', ok)).toMatchObject({ status: 0, stdout: expect.stringContaining('2 agent') });

        const clash = join(dir, 'clash.yaml');
        fs.writeFileSync(clash, `fleet: f
agents:
  - { id: echo, connector: { kind: in-process } }
presets:
  - { module: "${mod}", options: { word: hi } }
`);
        const failed = runCli('validate', clash);
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain('already in the fleet');
    });
});
