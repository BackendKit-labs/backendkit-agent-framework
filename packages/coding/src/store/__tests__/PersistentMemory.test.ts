import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { PersistentMemory } from '../PersistentMemory';

function makeTmpDir() {
    const dir = join(tmpdir(), `bk-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe('PersistentMemory', () => {
    let dir: string;
    beforeEach(() => { dir = makeTmpDir(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('starts empty', () => {
        const mem = new PersistentMemory(dir);
        expect(mem.get('k')).toBeUndefined();
        expect(mem.getAll()).toEqual({});
    });

    it('set and get round-trips', () => {
        const mem = new PersistentMemory(dir);
        mem.set('key', 'value');
        expect(mem.get('key')).toBe('value');
    });

    it('persists across instances (writes to disk)', () => {
        const mem1 = new PersistentMemory(dir);
        mem1.set('persistent', 'yes');
        const mem2 = new PersistentMemory(dir);
        expect(mem2.get('persistent')).toBe('yes');
    });

    it('getAll returns all entries', () => {
        const mem = new PersistentMemory(dir);
        mem.set('a', '1');
        mem.set('b', '2');
        expect(mem.getAll()).toEqual({ a: '1', b: '2' });
    });

    it('overwrite updates the value', () => {
        const mem = new PersistentMemory(dir);
        mem.set('k', 'first');
        mem.set('k', 'second');
        expect(mem.get('k')).toBe('second');
    });
});
