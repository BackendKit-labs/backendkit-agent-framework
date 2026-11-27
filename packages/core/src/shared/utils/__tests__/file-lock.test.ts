/** Audit 2026-11-26: D-01 (a compaction overwrote other writers' lines) and D-03 / B-09 (read-modify-write without a lock). */
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { withFileLock, withFileLockSync } from '../file-lock';
import { JsonFileStore } from '../../../agent-memory/stores/JsonFileStore';
import { FileLessonStore, FileRuleStore } from '../../../learning/stores';
import type { StoredRecord } from '../../../agent-memory/types';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-lock-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rec = (id: string): StoredRecord => ({ id, content: id, createdAt: new Date().toISOString() }) as unknown as StoredRecord;

describe('withFileLock', () => {
    it('waits while another writer holds the lock file, then runs', async () => {
        const path = join(dir, 'f.json');
        writeFileSync(`${path}.lock`, 'other');
        let ran = false;
        const pending = withFileLock(path, async () => { ran = true; });
        await new Promise(r => setTimeout(r, 80));
        expect(ran).toBe(false);
        rmSync(`${path}.lock`);
        await pending;
        expect(ran).toBe(true);
        expect(existsSync(`${path}.lock`)).toBe(false);
    });

    it('takes over a lock left by a dead process (older than staleMs)', async () => {
        const path = join(dir, 'f.json');
        writeFileSync(`${path}.lock`, 'dead');
        const old = new Date(Date.now() - 60_000);
        utimesSync(`${path}.lock`, old, old);
        await expect(withFileLock(path, async () => 'ok')).resolves.toBe('ok');
    });

    it('gives up after timeoutMs, saying who holds it', async () => {
        const path = join(dir, 'f.json');
        writeFileSync(`${path}.lock`, 'other');
        await expect(withFileLock(path, async () => 'x', { timeoutMs: 60 })).rejects.toThrow(/could not lock/);
        expect(() => withFileLockSync(path, () => 'x', { timeoutMs: 60 })).toThrow(/could not lock/);
    });
});

describe('JsonFileStore keeps what another writer appended (D-01)', () => {
    it('a compaction replays the file from disk, not this instance\'s copy', () => {
        const path = join(dir, 'mem.jsonl');
        const a = new JsonFileStore(path);
        a.insert(rec('a-1'));                       // a has loaded and cached the file
        const b = new JsonFileStore(path);
        b.insert(rec('b-1'));                       // another "process" appends behind a's back
        a.upsertMany(Array.from({ length: 1_100 }, () => rec('churn')));   // 1 100 dead lines: a compacts
        const ids = new JsonFileStore(path).getAll().map(r => r.id);
        expect(ids).toContain('b-1');
        expect(ids).toContain('a-1');
        expect(ids.sort()).toEqual(['a-1', 'b-1', 'churn']);
    });

    it('a record another writer deleted does not come back with the compaction', () => {
        const path = join(dir, 'mem.jsonl');
        const a = new JsonFileStore(path);
        a.insert(rec('x'));
        const b = new JsonFileStore(path);
        b.deleteByIds(['x']);
        a.upsertMany(Array.from({ length: 1_100 }, () => rec('churn')));
        expect(new JsonFileStore(path).getAll().map(r => r.id)).not.toContain('x');
    });
});

describe('learning stores do not lose concurrent changes (D-03, B-09)', () => {
    it('twenty approvals at once, through two instances of the store, all stay', async () => {
        const path = join(dir, 'rules.json');
        const one = new FileRuleStore(path); const two = new FileRuleStore(path);
        const rule = (i: number) => ({ id: `r${i}`, rule: { i }, approvedAt: new Date().toISOString(), approvedBy: { kind: 'human', id: 'ana' } }) as never;
        await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? one : two).add(rule(i))));
        expect((await one.list()).map(r => r.id).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `r${i}`).sort());
    });

    it('lessons too, adds and removes mixed', async () => {
        const path = join(dir, 'lessons.json');
        const s = new FileLessonStore(path);
        const lesson = (i: number) => ({ id: `l${i}` }) as never;
        await Promise.all(Array.from({ length: 10 }, (_, i) => s.add(lesson(i))));
        await Promise.all([s.remove('l1'), s.remove('l2'), s.add(lesson(99))]);
        expect((await s.list()).map(l => (l as { id: string }).id).sort()).toEqual(['l0', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l99']);
    });
});
