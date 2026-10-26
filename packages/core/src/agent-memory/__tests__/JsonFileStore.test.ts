import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonFileStore } from '../stores/JsonFileStore';
import type { StoredRecord } from '../types';

const rec = (id: string, extra: Record<string, unknown> = {}): StoredRecord => ({ id, ...extra }) as StoredRecord;

describe('JsonFileStore (append-only log)', () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfs-'));
        file = path.join(dir, 'mem.json');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const reopen = () => new JsonFileStore(file);
    const ids = (s: JsonFileStore) => s.getAll().map(r => r.id);

    it('persists insert, upsert and delete across a reopen, keeping order', () => {
        const s = reopen();
        s.insert(rec('a', { v: 1 }));
        s.insert(rec('b', { v: 1 }));
        s.insert(rec('c', { v: 1 }));
        s.upsert('b', rec('b', { v: 2 }));
        s.deleteByIds(['a']);
        s.upsert('d', rec('d', { v: 1 }));

        const again = reopen();
        expect(ids(again)).toEqual(['b', 'c', 'd']);
        expect((again.getAll()[0] as unknown as { v: number }).v).toBe(2);
        expect(again.count()).toBe(3);
    });

    it('deleteOldest keeps the newest N, also after reopening', () => {
        const s = reopen();
        for (const id of ['a', 'b', 'c', 'd']) s.insert(rec(id));
        s.deleteOldest(2);
        expect(ids(s)).toEqual(['c', 'd']);
        expect(ids(reopen())).toEqual(['c', 'd']);
    });

    it('an insert appends one line instead of rewriting the file', () => {
        const s = reopen();
        for (let i = 0; i < 50; i++) s.insert(rec(`r${i}`));
        const before = fs.readFileSync(file, 'utf-8');
        s.insert(rec('last'));
        const after = fs.readFileSync(file, 'utf-8');
        expect(after.startsWith(before)).toBe(true); // the old bytes were not touched
        expect(after.slice(before.length)).toBe('{"id":"last"}\n');
    });

    it('compacts once dead lines dominate, without losing data', () => {
        const s = reopen();
        s.insert(rec('keep'));
        for (let i = 0; i < 1_500; i++) s.upsert('hot', rec('hot', { i }));
        const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
        expect(lines.length).toBeLessThan(1_500); // 1 500 upserts of one id would otherwise be 1 501 lines
        const again = reopen();
        expect(ids(again)).toEqual(['keep', 'hot']);
        expect((again.getAll()[1] as unknown as { i: number }).i).toBe(1_499);
    });

    it('reads the old single-array format and converts it', () => {
        fs.writeFileSync(file, JSON.stringify([rec('x'), rec('y')], null, 2));
        const s = reopen();
        expect(ids(s)).toEqual(['x', 'y']);
        s.insert(rec('z'));
        const raw = fs.readFileSync(file, 'utf-8');
        expect(raw.trimStart().startsWith('[')).toBe(false); // now a log
        expect(ids(reopen())).toEqual(['x', 'y', 'z']);
    });

    it('survives a line torn by a crash and does not glue the next write onto it', () => {
        const s = reopen();
        s.insert(rec('a'));
        s.insert(rec('b'));
        fs.appendFileSync(file, '{"id":"torn","v'); // crash mid-write, no newline
        const again = reopen();
        expect(ids(again)).toEqual(['a', 'b']);
        again.insert(rec('c'));
        expect(ids(reopen())).toEqual(['a', 'b', 'c']);
    });

    it('a corrupt legacy array counts as empty, as before', () => {
        fs.writeFileSync(file, '[{"id":"a"},');
        expect(reopen().count()).toBe(0);
    });

    it('a missing file is an empty store', () => {
        expect(reopen().getAll()).toEqual([]);
    });
});
