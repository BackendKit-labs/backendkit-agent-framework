import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFlow, FlowClaimError, FlowDefinitionSchema, JournalConflict } from '@backendkit-labs/agent-core';
import type { StepExecutor } from '@backendkit-labs/agent-core';
import { journalConformance } from '@backendkit-labs/agent-core/testing';
import { SqliteRunJournal, SqlRunJournal, sqliteClient } from '../index';
import type { SyncSqliteDb } from '../index';

// `node:sqlite` is built in from Node 22.13, the `engines` of this package.
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SyncSqliteDb & { close(): void } };

const dirs: string[] = [];
const handles: Array<{ close(): void }> = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'flow-sql-')); dirs.push(d); return d; };
const open = (file: string) => { const db = new DatabaseSync(file); handles.push(db); return db; };
afterAll(() => {
    for (const h of handles) { try { h.close(); } catch { /* already closed */ } }
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const def = (ids: string[]) => FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: ids.map((id, i) => ({ id, agent: `agent-${id}`, prompt: `Do ${id}`, after: i > 0 ? [ids[i - 1]] : [] })),
});

function counting(fail: Set<string> = new Set()) {
    const calls: Array<{ id: string; key: string }> = [];
    const executor: StepExecutor = {
        run: async (s, i) => {
            calls.push({ id: s.id, key: i.idempotencyKey });
            if (fail.has(s.id)) throw new Error(`${s.id} down`);
            return { content: `out-${s.id}` };
        },
    };
    return { executor, calls };
}

{
    // The shared RunJournal battery (SPEC-0028 F0): the contract every journal passes. Each journal object gets its own
    // connection to the same file, as two processes would.
    const file = join(tmp(), 'conformance.db');
    journalConformance('SqliteRunJournal', {
        make: async () => { const j = new SqliteRunJournal(open(file)); await j.migrate(); return j; },
        exclusiveWriter: true, // one writer per run: a second object gets JournalConflict (D5)
        rejectsUnsafeIds: true,
    });
}

describe('SqliteRunJournal', () => {
    const fresh = async (file = join(tmp(), 'j.db')) => {
        const journal = new SqliteRunJournal(open(file));
        await journal.migrate();
        return { journal, file };
    };

    it('migrate is idempotent and the journal does not create tables by itself', async () => {
        const file = join(tmp(), 'm.db');
        const bare = new SqliteRunJournal(open(file));
        await expect(bare.begin({ runId: 'r', flow: 'f', inputPreview: '' })).rejects.toThrow(/no such table/i);
        await bare.migrate();
        await bare.migrate();
        await bare.begin({ runId: 'r', flow: 'f', inputPreview: '' });
        expect((await bare.get('r'))!.status).toBe('running');
    });

    it('a table prefix keeps two journals in one database apart, and an unsafe prefix is refused', async () => {
        const db = open(join(tmp(), 'p.db'));
        const a = new SqliteRunJournal(db, { tablePrefix: 'a_' });
        const b = new SqliteRunJournal(db, { tablePrefix: 'b_' });
        await a.migrate(); await b.migrate();
        await a.begin({ runId: 'only-a', flow: 'f', inputPreview: '' });
        expect(await b.get('only-a')).toBeUndefined();
        expect(() => new SqliteRunJournal(db, { tablePrefix: 'x; DROP TABLE y; --' })).toThrow(/invalid table prefix/);
    });

    it('ddl() returns the statements migrate runs, for an integrator with their own migration tool', async () => {
        const { journal } = await fresh();
        const ddl = journal.ddl();
        expect(ddl.some(s => /CREATE TABLE IF NOT EXISTS flow_run_events/.test(s))).toBe(true);
        expect(ddl.some(s => /CREATE TABLE IF NOT EXISTS flow_run_claims/.test(s))).toBe(true);
        expect(ddl.every(s => !/\?/.test(s))).toBe(true);
    });

    it('a second object that writes after another object wrote gets JournalConflict, and the run keeps the first one\'s events', async () => {
        const { journal: a, file } = await fresh();
        const b = new SqliteRunJournal(open(file));
        await a.begin({ runId: 'r', flow: 'f', inputPreview: '' });
        await a.step('r', 's1', { status: 'done', attempt: 1 });
        await b.step('r', 's2', { status: 'done', attempt: 1 }); // b continues after whatever the log holds
        await expect(a.step('r', 's3', { status: 'done', attempt: 1 })).rejects.toBeInstanceOf(JournalConflict);
        expect(Object.keys((await a.get('r'))!.steps).sort()).toEqual(['s1', 's2']);
        // The conflict dropped a's idea of the tail: it continues after what is there instead of colliding for ever.
        await a.step('r', 's3', { status: 'done', attempt: 1 });
        expect(Object.keys((await b.get('r'))!.steps).sort()).toEqual(['s1', 's2', 's3']);
    });

    it('one object\'s own concurrent writes to a run are ordered, not in conflict', async () => {
        const { journal } = await fresh();
        await journal.begin({ runId: 'r', flow: 'f', inputPreview: '' });
        await Promise.all(Array.from({ length: 30 }, (_, i) => journal.step('r', `s${i}`, { status: 'done', attempt: 1 })));
        expect(Object.keys((await journal.get('r'))!.steps)).toHaveLength(30);
    });

    it('the list index follows the status of the run, and an empty status filter matches nothing', async () => {
        const { journal } = await fresh();
        await journal.begin({ runId: 'a', flow: 'f', inputPreview: '' });
        await journal.begin({ runId: 'b', flow: 'f', inputPreview: '' });
        await journal.update('b', { status: 'awaiting_approval', waiting: { stepId: 'x', approvalId: 'ap' } });
        expect((await journal.list({ status: ['awaiting_approval'] })).map(r => r.runId)).toEqual(['b']);
        expect((await journal.list({ status: ['running'] })).map(r => r.runId)).toEqual(['a']);
        expect(await journal.list({ status: [] })).toEqual([]);
        expect((await journal.list()).map(r => r.runId).sort()).toEqual(['a', 'b']);
    });

    it('a claim is taken, kept by its owner, expires, and a release of an old token frees nothing', async () => {
        const { journal } = await fresh();
        const first = await journal.claim('c', 'a', 300); // wide margins: a busy machine must not let the claim expire early
        expect(first).not.toBeNull();
        expect(await journal.claim('c', 'b', 60_000)).toBeNull();
        await new Promise(r => setTimeout(r, 700));
        const second = await journal.claim('c', 'b', 60_000);
        expect(second).not.toBeNull();
        await first!(); // a's token is no longer the one stored
        expect(await journal.claim('c', 'c', 60_000)).toBeNull();
        await second!();
        expect(await journal.claim('c', 'c', 60_000)).not.toBeNull();
    });

    describe('with the flow engine', () => {
        it('runs a flow, and a new connection resumes it after the process died: done steps are not repeated', async () => {
            const { journal, file } = await fresh();
            // The first process: a is done, then it dies inside b (b stays "running").
            await journal.begin({ runId: 'resume', flow: 'f', inputPreview: '' });
            await journal.step('resume', 'a', { status: 'done', output: 'out-a', attempt: 1 });
            await journal.step('resume', 'b', { status: 'running', attempt: 1 });

            const second = new SqliteRunJournal(open(file)); // another process, same file
            const { executor, calls } = counting();
            const r = await runFlow(def(['a', 'b', 'c']), { executor, journal: second, runId: 'resume' });
            expect(r.status).toBe('completed');
            expect(calls.map(c => c.id)).toEqual(['b', 'c']);
            expect(calls[0].key).toBe('resume:b:2'); // the retry carries attempt 2
            expect((await second.get('resume'))!.status).toBe('done');
        });

        it('two runners cannot hold the same run: the second gets FlowClaimError', async () => {
            const { journal, file } = await fresh();
            let release!: () => void;
            const hold = new Promise<void>(res => { release = res; });
            const slow: StepExecutor = { run: async () => { await hold; return { content: 'x' }; } };
            const first = runFlow(def(['a']), { executor: slow, journal, runId: 'busy', owner: 'p1' });
            await new Promise(r => setTimeout(r, 50));
            const other = new SqliteRunJournal(open(file));
            await expect(runFlow(def(['a']), { executor: counting().executor, journal: other, runId: 'busy', owner: 'p2' }))
                .rejects.toBeInstanceOf(FlowClaimError);
            release();
            expect((await first).status).toBe('completed');
        });

        it('a failed step is retried on resume and only that step', async () => {
            const { journal } = await fresh();
            const r1 = await runFlow(def(['a', 'b']), { executor: counting(new Set(['b'])).executor, journal, runId: 'retry' });
            expect(r1.status).toBe('failed');
            const second = counting();
            const r2 = await runFlow(def(['a', 'b']), { executor: second.executor, journal, runId: 'retry' });
            expect(r2.status).toBe('completed');
            expect(second.calls.map(c => c.id)).toEqual(['b']);
        });
    });
});

describe('sqliteClient', () => {
    const memory = () => sqliteClient(open(':memory:'));

    it('a transaction commits when it resolves and rolls back when it throws', async () => {
        const c = memory();
        await c.query('CREATE TABLE t (n INTEGER)');
        await c.transaction(async tx => { await tx.query('INSERT INTO t VALUES (1)'); });
        await expect(c.transaction(async tx => { await tx.query('INSERT INTO t VALUES (2)'); throw new Error('boom'); })).rejects.toThrow('boom');
        expect((await c.query('SELECT n FROM t ORDER BY n')).rows).toEqual([{ n: 1 }]);
    });

    it('statements of two transactions never interleave, even when they await in the middle', async () => {
        const c = memory();
        await c.query('CREATE TABLE t (who TEXT, step INTEGER)');
        const slow = (who: string) => c.transaction(async tx => {
            await tx.query('INSERT INTO t VALUES (?, 1)', [who]);
            await new Promise(r => setTimeout(r, 15));
            await tx.query('INSERT INTO t VALUES (?, 2)', [who]);
        });
        await Promise.all([slow('a'), slow('b')]);
        const order = (await c.query('SELECT who FROM t')).rows.map(r => r.who).join('');
        expect(['aabb', 'bbaa']).toContain(order);
    });

    it('undefined is bound as NULL, and rowCount counts the rows a statement changed or returned', async () => {
        const c = memory();
        await c.query('CREATE TABLE t (a TEXT, b TEXT)');
        expect((await c.query('INSERT INTO t VALUES (?, ?)', ['x', undefined])).rowCount).toBe(1);
        expect((await c.query('SELECT a, b FROM t')).rows).toEqual([{ a: 'x', b: null }]);
        expect((await c.query('UPDATE t SET a = ? WHERE a = ?', ['y', 'nope'])).rowCount).toBe(0);
        expect((await c.query('SELECT * FROM t')).rowCount).toBe(1);
    });
});

describe('SqlRunJournal', () => {
    it('refuses an invalid table prefix before touching the database', () => {
        const never = { query: async () => { throw new Error('should not run'); }, transaction: async () => { throw new Error('should not run'); } };
        expect(() => new SqlRunJournal(never, { tablePrefix: '1bad' })).toThrow(/invalid table prefix/);
        expect(() => new SqlRunJournal(never, { tablePrefix: 'ok_' })).not.toThrow();
    });
});
