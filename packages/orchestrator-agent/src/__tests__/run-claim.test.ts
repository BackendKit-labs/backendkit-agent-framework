import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Redis } from 'ioredis';
import { RunStore } from '../run-store.js';
import { RedisRunStore } from '../run-store-redis.js';
import { claimInStore } from '../gate-claims.js';

describe('RunStore.claim (disk) — two processes on one directory', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('only one of two stores on the same directory gets the claim', async () => {
        const a = new RunStore(dir), b = new RunStore(dir); // two processes, same files
        const release = await a.claim('run-1');
        expect(release).toBeInstanceOf(Function);
        expect(await b.claim('run-1')).toBeNull();
        expect(await a.claim('run-2')).toBeInstanceOf(Function); // other runs are independent
        await release!();
        expect(await b.claim('run-1')).toBeInstanceOf(Function);  // free again after release
    });

    it('a claim older than the ttl belongs to a crashed holder and is taken over', async () => {
        const a = new RunStore(dir), b = new RunStore(dir);
        await a.claim('run-1');
        const file = path.join(dir, 'run-1.claim');
        const old = new Date(Date.now() - 120_000);
        fs.utimesSync(file, old, old);
        const taken = await b.claim('run-1', 60_000);
        expect(taken).toBeInstanceOf(Function);
    });

    it('a stale release does not free the claim someone else took over', async () => {
        const a = new RunStore(dir), b = new RunStore(dir);
        const releaseA = await a.claim('run-1');
        const file = path.join(dir, 'run-1.claim');
        const old = new Date(Date.now() - 120_000);
        fs.utimesSync(file, old, old);
        await b.claim('run-1', 60_000);   // b takes over a's expired claim
        await releaseA!();                // a wakes up late and releases
        expect(await a.claim('run-1')).toBeNull(); // b still holds it
    });

    it('claim files are not listed as runs and bad ids are refused', async () => {
        const s = new RunStore(dir);
        await s.claim('run-1');
        expect(await s.list()).toEqual([]);
        expect(await s.claim('../escape')).toBeNull();
    });
});

/** Just enough Redis: SET key val PX n NX, GET, DEL and the compare-and-delete script. */
function fakeRedis() {
    const data = new Map<string, string>();
    const redis = {
        set: jest.fn(async (key: string, val: string, ...args: Array<string | number>) => {
            if (args.includes('NX') && data.has(key)) return null;
            data.set(key, val);
            return 'OK';
        }),
        get: jest.fn(async (key: string) => data.get(key) ?? null),
        del: jest.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
        eval: jest.fn(async (_script: string, _n: number, key: string, token: string) => {
            if (data.get(key) === token) { data.delete(key); return 1; }
            return 0;
        }),
        zadd: jest.fn(), zrevrange: jest.fn(), zrangebyscore: jest.fn(), zrem: jest.fn(),
    };
    return { redis: redis as unknown as Redis, mock: redis, data };
}

describe('RedisRunStore.claim', () => {
    it('SET NX PX: the second process is refused, and gets it after the first releases', async () => {
        const { redis, mock } = fakeRedis();
        const a = new RedisRunStore(redis, 'orch:x'), b = new RedisRunStore(redis, 'orch:x');
        const release = await a.claim('run-1', 5000);
        expect(release).toBeInstanceOf(Function);
        expect(mock.set).toHaveBeenCalledWith('orch:x:claim:run-1', expect.any(String), 'PX', 5000, 'NX');
        expect(await b.claim('run-1')).toBeNull();
        await release!();
        expect(await b.claim('run-1')).toBeInstanceOf(Function);
    });

    it('release only deletes the key if it still holds this claim\'s token', async () => {
        const { redis, data } = fakeRedis();
        const a = new RedisRunStore(redis, 'orch:x');
        const release = await a.claim('run-1');
        data.set('orch:x:claim:run-1', 'someone-else');   // the ttl lapsed and another process claimed it
        await release!();
        expect(data.get('orch:x:claim:run-1')).toBe('someone-else');
    });

    it('claims are per run and per prefix', async () => {
        const { redis } = fakeRedis();
        const a = new RedisRunStore(redis, 'orch:x'), other = new RedisRunStore(redis, 'orch:y');
        await a.claim('run-1');
        expect(await a.claim('run-2')).toBeInstanceOf(Function);
        expect(await other.claim('run-1')).toBeInstanceOf(Function);
    });
});

describe('claimInStore', () => {
    it('delegates to the store when it has claim()', async () => {
        const release = async () => undefined;
        const store = { claim: jest.fn().mockResolvedValue(release) };
        expect(await claimInStore(store, 'r')).toBe(release);
        expect(store.claim).toHaveBeenCalledWith('r');
    });

    it('passes the null of a busy run through', async () => {
        expect(await claimInStore({ claim: async () => null }, 'r')).toBeNull();
    });

    it('a store without claim() gets a harmless no-op release', async () => {
        const release = await claimInStore({}, 'r');
        expect(release).toBeInstanceOf(Function);
        await expect(release!()).resolves.toBeUndefined();
    });
});
