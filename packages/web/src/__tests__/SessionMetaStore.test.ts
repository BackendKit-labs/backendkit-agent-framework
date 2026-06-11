import {
    InMemorySessionMetaStore,
    RedisSessionMetaStore,
} from '../store/SessionMetaStore';
import type { SessionMeta, RedisLike } from '../store/SessionMetaStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
    return {
        id:             overrides.id             ?? 'sess-1',
        createdAt:      overrides.createdAt      ?? '2026-01-01T00:00:00.000Z',
        lastActivityAt: overrides.lastActivityAt ?? '2026-01-01T00:01:00.000Z',
        userId:         overrides.userId,
        ...overrides,
    };
}

function makeRedis(store: Map<string, string> = new Map()): jest.Mocked<RedisLike> {
    return {
        get:  jest.fn(async (key: string) => store.get(key) ?? null),
        set:  jest.fn(async (key: string, value: string, _ex: string, _ttl: number) => { store.set(key, value); return 'OK'; }),
        del:  jest.fn(async (key: string) => { store.delete(key); return 1; }),
        keys: jest.fn(async (pattern: string) => {
            const prefix = pattern.replace('*', '');
            return [...store.keys()].filter(k => k.startsWith(prefix));
        }),
        quit: jest.fn(async () => 'OK'),
    };
}

// ── InMemorySessionMetaStore ──────────────────────────────────────────────────

describe('InMemorySessionMetaStore', () => {

    describe('set() / get()', () => {
        it('stores and retrieves a session by id', async () => {
            const store = new InMemorySessionMetaStore();
            const meta  = makeMeta();
            await store.set(meta.id, meta);
            expect(await store.get(meta.id)).toEqual(meta);
        });

        it('returns null for an unknown id', async () => {
            const store = new InMemorySessionMetaStore();
            expect(await store.get('does-not-exist')).toBeNull();
        });

        it('overwrites an existing entry on subsequent set() calls', async () => {
            const store   = new InMemorySessionMetaStore();
            const original = makeMeta({ lastActivityAt: '2026-01-01T00:00:00.000Z' });
            const updated  = makeMeta({ lastActivityAt: '2026-01-01T00:05:00.000Z' });
            await store.set('sess-1', original);
            await store.set('sess-1', updated);
            expect((await store.get('sess-1'))?.lastActivityAt).toBe('2026-01-01T00:05:00.000Z');
        });

        it('preserves extra fields on the metadata object', async () => {
            const store = new InMemorySessionMetaStore();
            const meta  = makeMeta({ customField: 'extra-data' });
            await store.set(meta.id, meta);
            expect((await store.get(meta.id) as SessionMeta & { customField: string }).customField).toBe('extra-data');
        });

        it('stores sessions with and without userId', async () => {
            const store     = new InMemorySessionMetaStore();
            const withUser  = makeMeta({ id: 'a', userId: 'user-1' });
            const noUser    = makeMeta({ id: 'b' });
            await store.set('a', withUser);
            await store.set('b', noUser);
            expect((await store.get('a'))?.userId).toBe('user-1');
            expect((await store.get('b'))?.userId).toBeUndefined();
        });
    });

    describe('delete()', () => {
        it('removes an existing entry', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('sess-1', makeMeta());
            await store.delete('sess-1');
            expect(await store.get('sess-1')).toBeNull();
        });

        it('is a no-op for an unknown id', async () => {
            const store = new InMemorySessionMetaStore();
            await expect(store.delete('ghost')).resolves.toBeUndefined();
        });

        it('does not affect other entries', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('a', makeMeta({ id: 'a' }));
            await store.set('b', makeMeta({ id: 'b' }));
            await store.delete('a');
            expect(await store.get('b')).not.toBeNull();
        });
    });

    describe('list()', () => {
        it('returns an empty array when the store is empty', async () => {
            expect(await new InMemorySessionMetaStore().list()).toEqual([]);
        });

        it('returns all stored sessions', async () => {
            const store = new InMemorySessionMetaStore();
            const a = makeMeta({ id: 'a' });
            const b = makeMeta({ id: 'b' });
            await store.set('a', a);
            await store.set('b', b);
            const list = await store.list();
            expect(list).toHaveLength(2);
            expect(list).toEqual(expect.arrayContaining([a, b]));
        });

        it('does not include deleted sessions', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('a', makeMeta({ id: 'a' }));
            await store.set('b', makeMeta({ id: 'b' }));
            await store.delete('a');
            const list = await store.list();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('b');
        });

        it('returns a snapshot — mutating the result does not affect the store', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('a', makeMeta({ id: 'a' }));
            const list = await store.list();
            list.pop();
            expect(await store.list()).toHaveLength(1);
        });
    });

    describe('close()', () => {
        it('clears all stored sessions', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('a', makeMeta({ id: 'a' }));
            await store.set('b', makeMeta({ id: 'b' }));
            await store.close();
            expect(await store.list()).toEqual([]);
        });

        it('is safe to call on an already-empty store', async () => {
            await expect(new InMemorySessionMetaStore().close()).resolves.toBeUndefined();
        });

        it('allows new entries to be stored after close()', async () => {
            const store = new InMemorySessionMetaStore();
            await store.set('a', makeMeta({ id: 'a' }));
            await store.close();
            await store.set('b', makeMeta({ id: 'b' }));
            expect(await store.get('b')).not.toBeNull();
        });
    });
});

// ── RedisSessionMetaStore ─────────────────────────────────────────────────────

describe('RedisSessionMetaStore', () => {

    describe('set() / get()', () => {
        it('serializes meta to JSON and stores it under the prefixed key', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            const meta  = makeMeta({ id: 'sess-1' });
            await store.set('sess-1', meta);
            expect(redis.set).toHaveBeenCalledWith(
                'bk:session:sess-1',
                JSON.stringify(meta),
                'EX',
                expect.any(Number),
            );
        });

        it('uses the default TTL of 4 hours (14400 seconds)', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            await store.set('x', makeMeta({ id: 'x' }));
            expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 14400);
        });

        it('uses a custom TTL when provided', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis, { ttlSeconds: 3600 });
            await store.set('x', makeMeta({ id: 'x' }));
            expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 3600);
        });

        it('retrieves and deserializes a stored session', async () => {
            const backing = new Map<string, string>();
            const redis   = makeRedis(backing);
            const store   = new RedisSessionMetaStore(redis);
            const meta    = makeMeta({ id: 'sess-2' });
            await store.set('sess-2', meta);
            expect(await store.get('sess-2')).toEqual(meta);
        });

        it('returns null when the key is not in Redis', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            expect(await store.get('missing')).toBeNull();
        });

        it('uses a custom key prefix when provided', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis, { prefix: 'myapp:sess:' });
            await store.set('abc', makeMeta({ id: 'abc' }));
            expect(redis.set).toHaveBeenCalledWith('myapp:sess:abc', expect.any(String), 'EX', expect.any(Number));
        });
    });

    describe('delete()', () => {
        it('calls redis.del() with the prefixed key', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            await store.delete('sess-3');
            expect(redis.del).toHaveBeenCalledWith('bk:session:sess-3');
        });

        it('removes the key from the backing store', async () => {
            const backing = new Map<string, string>();
            const redis   = makeRedis(backing);
            const store   = new RedisSessionMetaStore(redis);
            await store.set('d', makeMeta({ id: 'd' }));
            await store.delete('d');
            expect(await store.get('d')).toBeNull();
        });
    });

    describe('list()', () => {
        it('scans keys by prefix and returns deserialized sessions', async () => {
            const backing = new Map<string, string>();
            const redis   = makeRedis(backing);
            const store   = new RedisSessionMetaStore(redis);
            const a = makeMeta({ id: 'a' });
            const b = makeMeta({ id: 'b' });
            await store.set('a', a);
            await store.set('b', b);
            const list = await store.list();
            expect(list).toHaveLength(2);
            expect(list).toEqual(expect.arrayContaining([a, b]));
        });

        it('returns an empty array when no keys match the prefix', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            expect(await store.list()).toEqual([]);
        });

        it('calls redis.keys() with the correct glob pattern', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis, { prefix: 'custom:' });
            await store.list();
            expect(redis.keys).toHaveBeenCalledWith('custom:*');
        });

        it('skips null values returned by redis.get()', async () => {
            const redis = makeRedis();
            redis.keys.mockResolvedValueOnce(['bk:session:exists', 'bk:session:gone']);
            // get returns null for 'gone'
            redis.get
                .mockResolvedValueOnce(JSON.stringify(makeMeta({ id: 'exists' })))
                .mockResolvedValueOnce(null);
            const store = new RedisSessionMetaStore(redis);
            const list  = await store.list();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('exists');
        });
    });

    describe('close()', () => {
        it('calls redis.quit()', async () => {
            const redis = makeRedis();
            const store = new RedisSessionMetaStore(redis);
            await store.close();
            expect(redis.quit).toHaveBeenCalledTimes(1);
        });
    });
});
