import * as net from 'net';
import { Redis as IORedis } from 'ioredis';
import { journalConformance, journalConformanceCases } from '@backendkit-labs/agent-testkit';
import { APPEND_SCRIPT, BEGIN_SCRIPT, CLAIM_SCRIPT, RELEASE_SCRIPT, RedisRunJournal } from '../redis-journal';

/** In-memory stand-in that runs each script's logic in JS. The real Lua runs in the integration block below. */
class FakeRedis {
    lists = new Map<string, string[]>();
    sets = new Map<string, Set<string>>();
    strings = new Map<string, { v: string; exp: number }>();
    async eval(script: string, _n: number, ...a: string[]): Promise<number> {
        if (script === BEGIN_SCRIPT) {
            if (this.lists.has(a[0])) return 0;
            this.lists.set(a[0], [a[3]]);
            (this.sets.get(a[1]) ?? this.sets.set(a[1], new Set()).get(a[1])!).add(a[2]);
            return 1;
        }
        if (script === APPEND_SCRIPT) {
            const l = this.lists.get(a[0]);
            if (!l) return 0;
            l.push(a[1]);
            return 1;
        }
        if (script === CLAIM_SCRIPT) {
            const cur = this.strings.get(a[0]);
            const live = cur && cur.exp > Date.now() ? cur.v : undefined;
            if (live && !live.startsWith(`${a[1]}\n`)) return 0;
            this.strings.set(a[0], { v: `${a[1]}\n${a[2]}`, exp: Date.now() + Number(a[3]) });
            return 1;
        }
        if (script === RELEASE_SCRIPT) {
            if (this.strings.get(a[0])?.v === a[1]) { this.strings.delete(a[0]); return 1; }
            return 0;
        }
        throw new Error('unknown script');
    }
    async lrange(k: string): Promise<string[]> { return this.lists.get(k) ?? []; }
    async smembers(k: string): Promise<string[]> { return [...(this.sets.get(k) ?? [])]; }
}

const newRun = (runId: string, flow = 'f') => ({ runId, flow, owner: 'o', steps: [] } as any);

function contract(name: string, make: () => Promise<{ j: RedisRunJournal; done: () => Promise<void> }>) {
    describe(name, () => {
        let j: RedisRunJournal; let done: () => Promise<void>;
        beforeEach(async () => { ({ j, done } = await make()); });
        afterEach(async () => { await done(); });

        it('begins a run, folds steps and updates, and rejects a duplicate id', async () => {
            if (!j) return; // Redis not reachable
            await j.begin(newRun('r1'));
            await expect(j.begin(newRun('r1'))).rejects.toThrow('already exists');
            await j.step('r1', 's1', { status: 'running', attempt: 1 } as any);
            await j.step('r1', 's1', { status: 'done', attempt: 1, output: 'x' } as any);
            await j.update('r1', { status: 'done' } as any);
            const r = await j.get('r1');
            expect(r?.status).toBe('done');
            expect(r?.steps['s1']).toMatchObject({ status: 'done', output: 'x' });
            expect(r?.finishedAt).toBeDefined();
        });

        it('fails to write to a run that does not exist and returns undefined for get', async () => {
            if (!j) return; // Redis not reachable
            await expect(j.step('nope', 's', { status: 'running' } as any)).rejects.toThrow('does not exist');
            await expect(j.update('nope', {} as any)).rejects.toThrow('does not exist');
            expect(await j.get('nope')).toBeUndefined();
        });

        it('rejects invalid ids', async () => {
            if (!j) return; // Redis not reachable
            await expect(j.begin(newRun('../x'))).rejects.toThrow('invalid run id');
        });

        it('lists with filters, oldest first', async () => {
            if (!j) return; // Redis not reachable
            await j.begin(newRun('a', 'one'));
            await j.begin(newRun('b', 'two'));
            await j.update('b', { status: 'failed' } as any);
            expect((await j.list()).map(r => r.runId).sort()).toEqual(['a', 'b']);
            expect((await j.list({ flow: 'two' })).map(r => r.runId)).toEqual(['b']);
            expect((await j.list({ status: ['failed'] })).map(r => r.runId)).toEqual(['b']);
        });

        it('keeps one owner per run: others are refused until release or expiry; the owner can renew', async () => {
            if (!j) return; // Redis not reachable
            const rel = await j.claim('r', 'A', 60_000);
            expect(rel).not.toBeNull();
            expect(await j.claim('r', 'B', 60_000)).toBeNull();
            expect(await j.claim('r', 'A', 60_000)).not.toBeNull();
            await rel!();
            // A renewed with another token, so the first release must not free it
            expect(await j.claim('r', 'B', 60_000)).toBeNull();
        });

        it('lets another owner take over after release and after expiry', async () => {
            if (!j) return; // Redis not reachable
            const rel = await j.claim('r2', 'A', 60_000);
            await rel!();
            const b = await j.claim('r2', 'B', 40);
            expect(b).not.toBeNull();
            expect(await j.claim('r2', 'A', 60_000)).toBeNull();
            await new Promise(r => setTimeout(r, 80));
            expect(await j.claim('r2', 'A', 60_000)).not.toBeNull();
        });
    });
}

contract('RedisRunJournal (fake)', async () => ({
    j: new RedisRunJournal({ redis: new FakeRedis() as unknown as IORedis }),
    done: async () => undefined,
}));

const HOST = process.env.REDIS_HOST ?? 'localhost';
const PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);
const reachable = (): Promise<boolean> => new Promise(res => {
    const s = net.connect(PORT, HOST);
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
});

// Real Redis (runs the Lua scripts). Skipped when Redis is not reachable.
describe('RedisRunJournal (real Redis)', () => {
    let up = false;
    beforeAll(async () => { up = await reachable(); if (!up) console.warn('Redis not reachable: integration tests skipped'); });
    const prefix = `test-${Date.now()}`;
    contract('contract', async () => {
        if (!up) return { j: undefined as any, done: async () => undefined };
        const redis = new IORedis({ host: HOST, port: PORT });
        const j = new RedisRunJournal({ redis, prefix: `${prefix}-${Math.random().toString(36).slice(2)}` });
        return { j, done: async () => { redis.disconnect(); } };
    });
});

// The shared RunJournal battery (SPEC-0028 F0): the contract every journal passes, with the fake and with real Redis.
// Redis appends atomically and does not fence writers, so concurrent writers on one run all land (exclusiveWriter stays false).
const fakeForConformance = new FakeRedis();
journalConformance('RedisRunJournal (fake)', {
    make: () => new RedisRunJournal({ redis: fakeForConformance as unknown as IORedis }),
    rejectsUnsafeIds: true,
});

describe('RedisRunJournal (real Redis): RunJournal conformance', () => {
    let up = false;
    const clients: IORedis[] = [];
    const prefix = `conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    beforeAll(async () => { up = await reachable(); });
    afterAll(() => { for (const r of clients) r.disconnect(); });
    const cases = journalConformanceCases({
        make: () => {
            const redis = new IORedis({ host: HOST, port: PORT });
            clients.push(redis);
            return new RedisRunJournal({ redis, prefix });
        },
        rejectsUnsafeIds: true,
    });
    for (const c of cases) it(c.name, async () => { if (!up) return; await c.run(); }); // skipped when Redis is not reachable
});
