import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { atomicWrite, atomicWriteSync } from '../atomic-write';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-atomic-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('atomicWrite', () => {
    it('writes the content and leaves no temp file behind', async () => {
        const file = join(dir, 'a.json');
        await atomicWrite(file, '{"a":1}');
        atomicWriteSync(file, '{"a":2}');
        expect(readFileSync(file, 'utf-8')).toBe('{"a":2}');
        expect(readdirSync(dir)).toEqual(['a.json']);
    });

    it('does not use a fixed temp name: a file named <target>.tmp is left alone', async () => {
        const file = join(dir, 'c.json');
        writeFileSync(`${file}.tmp`, 'belongs to another writer');
        await atomicWrite(file, '{"c":1}');
        atomicWriteSync(file, '{"c":2}');
        expect(readFileSync(`${file}.tmp`, 'utf-8')).toBe('belongs to another writer');
        expect(readFileSync(file, 'utf-8')).toBe('{"c":2}');
    });
});
