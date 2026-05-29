import { SessionMemory } from '../SessionMemory';

describe('SessionMemory', () => {
    let mem: SessionMemory;
    beforeEach(() => { mem = new SessionMemory(); });

    it('get returns undefined for unknown key', () => {
        expect(mem.get('x')).toBeUndefined();
    });

    it('set then get returns the value', () => {
        mem.set('k', 'v');
        expect(mem.get('k')).toBe('v');
    });

    it('set overwrites existing key', () => {
        mem.set('k', 'first');
        mem.set('k', 'second');
        expect(mem.get('k')).toBe('second');
    });

    it('getAll returns all entries as plain object', () => {
        mem.set('a', '1');
        mem.set('b', '2');
        expect(mem.getAll()).toEqual({ a: '1', b: '2' });
    });

    it('clear removes all entries', () => {
        mem.set('k', 'v');
        mem.clear();
        expect(mem.get('k')).toBeUndefined();
        expect(mem.getAll()).toEqual({});
    });
});
