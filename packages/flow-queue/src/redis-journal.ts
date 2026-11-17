import { randomBytes } from 'node:crypto';
import { foldEvents, journalMatches } from '@backendkit-labs/agent-core';
import type {
    JournalEvent, JournalRun, JournalRunStatus, NewJournalRun, RunJournal, RunPatch, StepPatch,
} from '@backendkit-labs/agent-core';
import { Redis as IORedis } from 'ioredis';

/**
 * `RunJournal` on Redis (SPEC-0023): the same event log the file and memory journals keep, so a run survives the process
 * and any process sharing the Redis can resume it.
 *
 * - `<prefix>:run:<id>:log`: a list with one JSON event per entry, append-only; the run is rebuilt by folding them.
 * - `<prefix>:run:<id>:claim`: `owner\ntoken` with a TTL (`SET PX`): one owner per run, expiry is Redis's own.
 * - `<prefix>:runs`: the set of run ids, for `list`.
 *
 * Each mutation is one Lua script, so "create only if absent", "append only if it exists" and "take the claim only if free or
 * mine" are atomic. Nothing expires on its own except claims: delete finished runs with your own retention job.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const BEGIN_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[1])
return 1`;

export const APPEND_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('RPUSH', KEYS[1], ARGV[1])
return 1`;

export const CLAIM_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur and string.sub(cur, 1, #ARGV[1] + 1) ~= ARGV[1] .. '\\n' then return 0 end
redis.call('SET', KEYS[1], ARGV[1] .. '\\n' .. ARGV[2], 'PX', ARGV[3])
return 1`;

export const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export interface RedisRunJournalOptions {
    /** Redis URL or an ioredis instance. A URL is owned and closed by `close()`. */
    redis: string | IORedis;
    /** Key prefix. Default `flow`. */
    prefix?: string;
}

export class RedisRunJournal implements RunJournal {
    private readonly redis: IORedis;
    private readonly owned: boolean;
    private readonly prefix: string;

    constructor(opts: RedisRunJournalOptions) {
        this.owned = typeof opts.redis === 'string';
        this.redis = typeof opts.redis === 'string' ? new IORedis(opts.redis) : opts.redis;
        this.prefix = opts.prefix ?? 'flow';
    }

    async begin(run: NewJournalRun): Promise<void> {
        this.checkId(run.runId);
        const ev: JournalEvent = { kind: 'begin', at: new Date().toISOString(), run };
        const ok = await this.redis.eval(BEGIN_SCRIPT, 2, this.logKey(run.runId), `${this.prefix}:runs`, run.runId, JSON.stringify(ev));
        if (ok !== 1) throw new Error(`run "${run.runId}" already exists`);
    }

    async step(runId: string, stepId: string, patch: StepPatch): Promise<void> {
        await this.append(runId, { kind: 'step', at: new Date().toISOString(), stepId, patch });
    }

    async update(runId: string, patch: RunPatch): Promise<void> {
        await this.append(runId, { kind: 'update', at: new Date().toISOString(), patch });
    }

    async claim(runId: string, owner: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
        this.checkId(runId);
        const token = randomBytes(8).toString('hex');
        const ok = await this.redis.eval(CLAIM_SCRIPT, 1, this.claimKey(runId), owner, token, String(Math.max(1, Math.ceil(ttlMs))));
        if (ok !== 1) return null;
        return async () => {
            await this.redis.eval(RELEASE_SCRIPT, 1, this.claimKey(runId), `${owner}\n${token}`);
        };
    }

    async get(runId: string): Promise<JournalRun | undefined> {
        this.checkId(runId);
        const raw = await this.redis.lrange(this.logKey(runId), 0, -1);
        return foldEvents(raw.map(r => JSON.parse(r) as JournalEvent));
    }

    async list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]> {
        const ids = await this.redis.smembers(`${this.prefix}:runs`);
        const out: JournalRun[] = [];
        for (const id of ids) {
            const r = await this.get(id);
            if (r && journalMatches(r, filter)) out.push(r);
        }
        return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }

    async close(): Promise<void> {
        if (this.owned) this.redis.disconnect();
    }

    private async append(runId: string, ev: JournalEvent): Promise<void> {
        this.checkId(runId);
        const ok = await this.redis.eval(APPEND_SCRIPT, 1, this.logKey(runId), JSON.stringify(ev));
        if (ok !== 1) throw new Error(`run "${runId}" does not exist`);
    }

    private checkId(id: string): void {
        if (!ID.test(id)) throw new Error(`invalid run id "${id}"`);
    }

    private logKey(runId: string): string { return `${this.prefix}:run:${runId}:log`; }
    private claimKey(runId: string): string { return `${this.prefix}:run:${runId}:claim`; }
}
