import { RedisSessionMetaStore } from '../store/SessionMetaStore';
import type { RedisLike, SessionMeta } from '../store/SessionMetaStore';

const meta = (id: string): SessionMeta => ({ id, createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z' });

/** A Redis double with SCAN pagination (3 keys per page), MGET and call counters. */
function redis(count: number, opts: { withScan?: boolean; withMget?: boolean; dupes?: boolean } = {}) {
    const data = new Map<string, string>();
    for (let i = 0; i < count; i++) data.set(`bk:session:s${i}`, JSON.stringify(meta(`s${i}`)));
    data.set('other:key', 'ignored');

    const calls = { keys: 0, scan: 0, get: 0, mget: 0 };
    const r: RedisLike = {
        get: async k => { calls.get++; return data.get(k) ?? null; },
        set: async () => 'OK',
        del: async () => 1,
        keys: async pattern => { calls.keys++; const p = pattern.replace('*', ''); return [...data.keys()].filter(k => k.startsWith(p)); },
        quit: async () => 'OK',
        ...(opts.withScan === false ? {} : {
            scan: async (cursor: string, _m: 'MATCH', pattern: string) => {
                calls.scan++;
                const p = pattern.replace('*', '');
                const all = [...data.keys()].filter(k => k.startsWith(p));
                const from = Number(cursor);
                const page = all.slice(from, from + 3);
                if (opts.dupes && page.length > 0) page.push(page[0]); // SCAN may repeat a key
                const next = from + 3 >= all.length ? '0' : String(from + 3);
                return [next, page] as [string, string[]];
            },
        }),
        ...(opts.withMget === false ? {} : {
            mget: async (keys: string[]) => { calls.mget++; return keys.map(k => data.get(k) ?? null); },
        }),
    };
    return { r, calls };
}

describe('RedisSessionMetaStore.list — SCAN and MGET instead of KEYS and N GETs', () => {
    it('walks the keyspace with SCAN pages and never calls KEYS', async () => {
        const { r, calls } = redis(10);
        const all = await new RedisSessionMetaStore(r).list();
        expect(all.map(m => m.id).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`).sort());
        expect(calls.scan).toBe(4);   // 10 keys, 3 per page
        expect(calls.keys).toBe(0);
    });

    it('reads values with MGET in one call per chunk, not one GET per key', async () => {
        const { r, calls } = redis(10);
        await new RedisSessionMetaStore(r).list();
        expect(calls.mget).toBe(1);
        expect(calls.get).toBe(0);
    });

    it('chunks MGET for a large keyspace', async () => {
        const { r, calls } = redis(1200);
        const all = await new RedisSessionMetaStore(r).list();
        expect(all).toHaveLength(1200);
        expect(calls.mget).toBe(3); // 500 + 500 + 200
    });

    it('a key SCAN returns twice is listed once', async () => {
        const { r } = redis(7, { dupes: true });
        const all = await new RedisSessionMetaStore(r).list();
        expect(all).toHaveLength(7);
    });

    it('ignores keys outside the prefix and tolerates entries that expired between SCAN and MGET', async () => {
        const { r } = redis(3);
        const orig = r.mget!;
        r.mget = async keys => { const v = await orig(keys); v[0] = null; return v; };
        expect(await new RedisSessionMetaStore(r).list()).toHaveLength(2);
    });

    it('falls back to KEYS and GET for a client without scan/mget (plain RedisLike)', async () => {
        const { r, calls } = redis(5, { withScan: false, withMget: false });
        const all = await new RedisSessionMetaStore(r).list();
        expect(all).toHaveLength(5);
        expect(calls.keys).toBe(1);
        expect(calls.get).toBe(5);
    });
});
