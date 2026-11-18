import { runFlow, FlowClaimError, FlowDefinitionSchema, JournalConflict } from '@backendkit-labs/agent-core';
import type { StepExecutor } from '@backendkit-labs/agent-core';
import { journalConformance } from '@backendkit-labs/agent-core/testing';
import { PostgresRunJournal, pgClient, toPositional } from '../index';
import type { PgPoolLike, PgPoolClient, PgQueryResult } from '../index';

// Two parts. The first needs no database: the placeholder conversion and the client over a fake pool. The second runs against a real
// Postgres when TEST_POSTGRES_URL is set (`postgres://user:pass@host:5432/db`) and is skipped otherwise, so the CI needs no service.

describe('toPositional', () => {
    it('turns ? into $1, $2... in order', () => {
        expect(toPositional('SELECT * FROM t WHERE a = ? AND b IN (?, ?)')).toBe('SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)');
    });
    it('leaves a ? inside a single-quoted literal alone, including an escaped quote', () => {
        expect(toPositional("SELECT '?' AS q, 'it''s ?' AS r WHERE a = ?")).toBe("SELECT '?' AS q, 'it''s ?' AS r WHERE a = $1");
    });
    it('the statements the journal writes convert to as many parameters as they have placeholders', () => {
        const journal = new PostgresRunJournal({ query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('no'); } });
        for (const sql of journal.ddl()) expect(toPositional(sql)).toBe(sql); // DDL has no parameters
    });
});

describe('pgClient over a fake pool', () => {
    function fakePool(script: (text: string) => PgQueryResult | Error = () => ({ rows: [], rowCount: null })) {
        const log: string[] = [];
        const released: Array<boolean | Error | undefined> = [];
        const run = async (text: string, values?: unknown[]): Promise<PgQueryResult> => {
            log.push(values ? `${text} ${JSON.stringify(values)}` : text);
            const r = script(text);
            if (r instanceof Error) throw r;
            return r;
        };
        const conn: PgPoolClient = { query: run, release: d => { released.push(d); } };
        const pool: PgPoolLike = { query: run, connect: async () => conn };
        return { pool, log, released };
    }

    it('query converts the placeholders, binds undefined as null and takes rowCount from the result, or from the rows when it is null', async () => {
        const { pool, log } = fakePool(text => (text.startsWith('SELECT') ? { rows: [{ a: 1 }, { a: 2 }], rowCount: null } : { rows: [], rowCount: 3 }));
        const c = pgClient(pool);
        expect(await c.query('UPDATE t SET a = ? WHERE b = ?', ['x', undefined])).toEqual({ rows: [], rowCount: 3 });
        expect((await c.query('SELECT a FROM t')).rowCount).toBe(2);
        expect(log[0]).toBe('UPDATE t SET a = $1 WHERE b = $2 ["x",null]');
    });

    it('a transaction runs BEGIN, its statements and COMMIT on one connection, and releases it', async () => {
        const { pool, log, released } = fakePool();
        await pgClient(pool).transaction(async tx => { await tx.query('INSERT INTO t VALUES (?)', [1]); });
        expect(log).toEqual(['BEGIN', 'INSERT INTO t VALUES ($1) [1]', 'COMMIT']);
        expect(released).toEqual([false]);
    });

    it('a transaction that throws is rolled back, the error reaches the caller, and the connection is released', async () => {
        const { pool, log, released } = fakePool();
        await expect(pgClient(pool).transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(log).toEqual(['BEGIN', 'ROLLBACK']);
        expect(released).toEqual([false]);
    });

    it('a connection that cannot roll back is destroyed, not returned to the pool', async () => {
        const { pool, released } = fakePool(text => (text === 'ROLLBACK' ? new Error('connection lost') : { rows: [], rowCount: 0 }));
        await expect(pgClient(pool).transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(released).toEqual([true]);
    });

    it('PostgresRunJournal adds CREATE SCHEMA to its DDL only when a schema is given, and refuses an unsafe one', () => {
        const { pool } = fakePool();
        expect(new PostgresRunJournal(pool).ddl()[0]).toMatch(/CREATE TABLE/);
        const withSchema = new PostgresRunJournal(pool, { schema: 'flows' });
        expect(withSchema.ddl()[0]).toBe('CREATE SCHEMA IF NOT EXISTS flows');
        expect(withSchema.ddl().some(s => /flows\.flow_run_events/.test(s))).toBe(true);
        expect(withSchema.ddl().some(s => /CREATE INDEX IF NOT EXISTS flow_runs_flow_idx ON flows\.flow_runs/.test(s))).toBe(true);
        expect(() => new PostgresRunJournal(pool, { schema: 'x; DROP TABLE y' })).toThrow(/invalid schema/);
    });
});

// ── Against a real Postgres ──────────────────────────────────────────────────────────────────────────────────────

const url = process.env.TEST_POSTGRES_URL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Pool: (new (opts: { connectionString: string; max?: number }) => PgPoolLike & { end(): Promise<void> }) | undefined;
if (url) { Pool = (require('pg') as { Pool: typeof Pool }).Pool; } else { console.warn('TEST_POSTGRES_URL is not set: the Postgres tests are skipped'); }

const pools: Array<{ end(): Promise<void> }> = [];
const newPool = (max = 10) => { const p = new Pool!({ connectionString: url!, max }); pools.push(p); return p; };
const schema = `bk_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

if (url) {
    // The shared RunJournal battery: the contract every journal passes. Each journal object has its own pool, so its own connections,
    // as separate processes would.
    journalConformance('PostgresRunJournal', {
        make: async () => { const j = new PostgresRunJournal(newPool(4), { schema }); await j.migrate(); return j; },
        exclusiveWriter: true, // one writer per run: a second object gets JournalConflict (D5)
        rejectsUnsafeIds: true,
    });

    afterAll(async () => {
        const cleaner = new Pool!({ connectionString: url, max: 1 });
        await cleaner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await cleaner.end();
        for (const p of pools) await p.end();
    });
}

const def = (ids: string[]) => FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: ids.map((id, i) => ({ id, agent: `agent-${id}`, prompt: `Do ${id}`, after: i > 0 ? [ids[i - 1]] : [] })),
});

(url ? describe : describe.skip)('PostgresRunJournal', () => {
    /** Tables of their own in the shared schema; `make` opens another journal object over the same tables, with its own pool. */
    const fresh = async (tag = '') => {
        const tablePrefix = `t${tag}_${Math.random().toString(36).slice(2, 7)}_`;
        const make = (max = 10) => new PostgresRunJournal(newPool(max), { schema, tablePrefix });
        const journal = make();
        await journal.migrate();
        return { journal, make };
    };

    it('migrate is idempotent, and two table prefixes in one schema keep their runs apart', async () => {
        const { journal: a } = await fresh('a'); await a.migrate();
        const { journal: b } = await fresh('b');
        await a.begin({ runId: 'only-a', flow: 'f', inputPreview: '' });
        expect(await b.get('only-a')).toBeUndefined();
        expect((await a.get('only-a'))!.status).toBe('running');
    });

    it('thirty processes (a pool each) racing for one claim: exactly one wins', async () => {
        const { journal, make } = await fresh();
        await journal.begin({ runId: 'race', flow: 'f', inputPreview: '' });
        const journals = Array.from({ length: 30 }, () => make(2));
        const claims = await Promise.all(journals.map((j, i) => j.claim('race', `p${i}`, 60_000)));
        expect(claims.filter(c => c !== null)).toHaveLength(1);
    }, 60_000);

    it('writers that run at the same time: every write is acknowledged or refused as JournalConflict, and an acknowledged one is stored', async () => {
        const { journal, make } = await fresh();
        await journal.begin({ runId: 'w', flow: 'f', inputPreview: '' });
        const writers = Array.from({ length: 6 }, () => make(2));
        const results = await Promise.allSettled(
            Array.from({ length: 60 }, (_, i) => writers[i % 6].step('w', `s${i}`, { status: 'done', attempt: 1 })),
        );
        const stored = Object.keys((await journal.get('w'))!.steps);
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') expect(stored).toContain(`s${i}`);
            else expect((r.reason as Error).name).toBe('JournalConflict');
        });
        expect(results.some(r => r.status === 'fulfilled')).toBe(true);
        expect(results.some(r => r.status === 'rejected')).toBe(true); // six objects on one run: the fence did refuse some
    }, 60_000);

    it('a second object that writes after another wrote gets JournalConflict, and keeps going from what is there afterwards', async () => {
        const { journal: a, make } = await fresh();
        const b = make();
        await a.begin({ runId: 'r', flow: 'f', inputPreview: '' });
        await a.step('r', 's1', { status: 'done', attempt: 1 });
        await b.step('r', 's2', { status: 'done', attempt: 1 });
        await expect(a.step('r', 's3', { status: 'done', attempt: 1 })).rejects.toBeInstanceOf(JournalConflict);
        await a.step('r', 's3', { status: 'done', attempt: 1 });
        expect(Object.keys((await b.get('r'))!.steps).sort()).toEqual(['s1', 's2', 's3']);
    });

    it('a flow resumes after the process died, through another pool: done steps are not repeated', async () => {
        const { journal, make } = await fresh();
        await journal.begin({ runId: 'resume', flow: 'f', inputPreview: '' });
        await journal.step('resume', 'a', { status: 'done', output: 'out-a', attempt: 1 });
        await journal.step('resume', 'b', { status: 'running', attempt: 1 });
        const calls: Array<{ id: string; key: string }> = [];
        const executor: StepExecutor = { run: async (s, i) => { calls.push({ id: s.id, key: i.idempotencyKey }); return { content: `out-${s.id}` }; } };
        const r = await runFlow(def(['a', 'b', 'c']), { executor, journal: make(), runId: 'resume' });
        expect(r.status).toBe('completed');
        expect(calls.map(x => x.id)).toEqual(['b', 'c']);
        expect(calls[0].key).toBe('resume:b:2');
    });

    it('two runners cannot hold the same run: the second gets FlowClaimError', async () => {
        const { journal, make } = await fresh();
        let release!: () => void;
        const hold = new Promise<void>(res => { release = res; });
        const slow: StepExecutor = { run: async () => { await hold; return { content: 'x' }; } };
        const running = runFlow(def(['a']), { executor: slow, journal, runId: 'busy', owner: 'p1' });
        await new Promise(r => setTimeout(r, 100));
        await expect(runFlow(def(['a']), { executor: { run: async () => ({ content: 'y' }) }, journal: make(), runId: 'busy', owner: 'p2' }))
            .rejects.toBeInstanceOf(FlowClaimError);
        release();
        expect((await running).status).toBe('completed');
    });

    it('list follows the status of the run through the index, oldest first', async () => {
        const { journal: j } = await fresh();
        for (const id of ['a', 'b', 'c']) { await j.begin({ runId: id, flow: 'f', inputPreview: '' }); await new Promise(r => setTimeout(r, 5)); }
        await j.update('b', { status: 'awaiting_approval', waiting: { stepId: 'x', approvalId: 'ap' } });
        expect((await j.list()).map(r => r.runId)).toEqual(['a', 'b', 'c']);
        expect((await j.list({ status: ['awaiting_approval'] })).map(r => r.runId)).toEqual(['b']);
        expect(await j.list({ status: [] })).toEqual([]);
    });
});
