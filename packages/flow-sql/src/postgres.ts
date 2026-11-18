import { SqlRunJournal } from './sql-run-journal';
import type { SqlRunJournalOptions } from './sql-run-journal';
import type { SqlClient, SqlQueryable, SqlRows } from './client';

/** What `pg` returns from a query. `rowCount` is null for statements that have no count (DDL). */
export interface PgQueryResult {
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
}

export interface PgQueryable {
    query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}

/** A client checked out of a pool. `release(true)` throws the connection away instead of returning it. */
export interface PgPoolClient extends PgQueryable {
    release(destroy?: boolean | Error): void;
}

/** The part of `pg.Pool` the journal uses. A `pg.Pool` satisfies it as it is. */
export interface PgPoolLike extends PgQueryable {
    connect(): Promise<PgPoolClient>;
}

/**
 * `?` placeholders to `$1, $2...`. A `?` inside a single-quoted literal is text, not a parameter. The journal writes no `?` inside
 * a literal and no operator that uses one, so this is all the conversion it needs.
 */
export function toPositional(sql: string): string {
    let n = 0;
    let out = '';
    let inLiteral = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'") {
            // `''` inside a literal is an escaped quote: stay inside.
            if (inLiteral && sql[i + 1] === "'") { out += "''"; i++; continue; }
            inLiteral = !inLiteral;
        }
        out += ch === '?' && !inLiteral ? `$${++n}` : ch;
    }
    return out;
}

const rows = (r: PgQueryResult): SqlRows => ({ rows: r.rows, rowCount: r.rowCount ?? r.rows.length });
const bind = (params: readonly unknown[] | undefined): unknown[] | undefined => params?.map(p => (p === undefined ? null : p));

/**
 * A `SqlClient` over a `pg.Pool` (or anything shaped like one). A transaction takes its own connection from the pool, so
 * transactions of one process run in parallel and Postgres keeps them apart; unlike SQLite there is no process-wide queue.
 */
export function pgClient(pool: PgPoolLike): SqlClient {
    const on = (q: PgQueryable): SqlQueryable => ({
        query: async (sql, params) => rows(await q.query(toPositional(sql), bind(params))),
    });
    return {
        ...on(pool),
        transaction: async <T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> => {
            const conn = await pool.connect();
            let broken = false;
            try {
                await conn.query('BEGIN');
                const result = await fn(on(conn));
                await conn.query('COMMIT');
                return result;
            } catch (err) {
                try { await conn.query('ROLLBACK'); } catch { broken = true; } // a connection that cannot roll back is not reused
                throw err;
            } finally {
                conn.release(broken);
            }
        },
    };
}

/**
 * `RunJournal` on Postgres (SPEC-0028 F2): the runs live in the database you already run, and any process that shares it can resume
 * them. Give it a `pg.Pool` and call `migrate()` once.
 *
 * ```ts
 * import { Pool } from 'pg';
 * const journal = new PostgresRunJournal(new Pool({ connectionString }), { schema: 'flows' });
 * await journal.migrate();
 * await runFlow(def, { journal, runId, executor });
 * ```
 *
 * The claim expires by the clock of the process that takes it (as in the SQLite journal): keep the TTL well above the clock
 * difference between your processes. The pool is yours; the journal never closes it.
 */
export class PostgresRunJournal extends SqlRunJournal {
    constructor(pool: PgPoolLike, opts: SqlRunJournalOptions = {}) {
        super(pgClient(pool), opts);
    }

    /** As the base, plus `CREATE SCHEMA IF NOT EXISTS` when a schema was given. */
    override ddl(): string[] {
        const statements = super.ddl();
        return this.schema ? [`CREATE SCHEMA IF NOT EXISTS ${this.schema}`, ...statements] : statements;
    }
}
