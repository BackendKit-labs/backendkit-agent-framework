import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunJournal } from '../index';

// Real processes over one file (SPEC-0028 F1): what the in-process tests cannot show. They use the BUILT package (the CI builds before
// it tests); without `dist` they are skipped, not failed.
const worker = join(__dirname, 'fixtures', 'worker.js');
const built = existsSync(join(__dirname, '..', '..', 'dist', 'index.js'));
let DatabaseSync: (new (path: string) => { exec(sql: string): void; prepare(sql: string): never; close(): void }) | undefined;
try { DatabaseSync = (require('node:sqlite') as { DatabaseSync: typeof DatabaseSync }).DatabaseSync; } catch { /* old Node */ }
const suite = built && DatabaseSync ? describe : describe.skip;
if (!built) console.warn('dist is not built: cross-process tests skipped');

function run(args: string[]): Promise<Array<Record<string, unknown>>> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--no-warnings', worker, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('close', code => {
            if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}${out}`));
            resolve(out.split('\n').filter(Boolean).map(l => JSON.parse(l)));
        });
    });
}

suite('SqliteRunJournal across processes', () => {
    let dir: string; let file: string; let db: { close(): void };
    let journal: SqliteRunJournal;
    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'flow-sql-xp-'));
        file = join(dir, 'x.db');
        db = new DatabaseSync!(file);
        journal = new SqliteRunJournal(db as never);
        await journal.migrate();
    });
    afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

    it('of six processes racing for a claim on one run, exactly one wins', async () => {
        await journal.begin({ runId: 'race', flow: 'f', inputPreview: '' });
        const results = (await Promise.all(Array.from({ length: 6 }, (_, i) => run(['claim', file, 'race', `p${i}`])))).flat();
        expect(results).toHaveLength(6);
        expect(results.filter(r => r.won === true)).toHaveLength(1);
    }, 60_000);

    it('processes that write to one run at the same time never lose an acknowledged write and never fail on the lock', async () => {
        await journal.begin({ runId: 'w', flow: 'f', inputPreview: '' });
        const results = (await Promise.all(['a', 'b', 'c', 'd'].map(who => run(['append', file, 'w', who, '8'])))).flat();
        expect(results).toHaveLength(32);
        // One writer per run: a write is acknowledged or refused as JournalConflict. A lock error would be a failure of the package.
        const failures = results.filter(r => r.ok === false);
        expect(failures.every(f => f.error === 'JournalConflict')).toBe(true);
        expect(results.some(r => r.ok === true)).toBe(true);
        const stored = Object.keys((await journal.get('w'))!.steps);
        for (const r of results.filter(x => x.ok === true)) expect(stored).toContain(r.stepId);
    }, 60_000);
});
