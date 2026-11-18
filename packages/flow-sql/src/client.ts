/**
 * The smallest SQL client the journal needs. It is injected, so the package imposes no driver and no driver version: a
 * driver is wrapped in a few lines (`sqliteClient` below for SQLite; the Postgres client of SPEC-0028 F2 for `pg`).
 *
 * Statements are written with `?` placeholders. A client for a database that uses another style (`$1` in Postgres)
 * converts them.
 */
export interface SqlRows {
    /** Rows of a statement that returns them (`SELECT`); empty otherwise. */
    rows: Array<Record<string, unknown>>;
    /** Rows returned by a `SELECT`, or rows changed by an `INSERT`, `UPDATE` or `DELETE` (including an upsert that took effect). */
    rowCount: number;
}

export interface SqlQueryable {
    query(sql: string, params?: readonly unknown[]): Promise<SqlRows>;
}

export interface SqlClient extends SqlQueryable {
    /**
     * Runs `fn` in one transaction: committed if it resolves, rolled back if it throws. Two transactions of the same client
     * never interleave their statements.
     */
    transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
}

/** What a synchronous SQLite handle must offer. `node:sqlite` (`DatabaseSync`) and `better-sqlite3` both do. */
export interface SyncSqliteStatement {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint };
}

export interface SyncSqliteDb {
    prepare(sql: string): SyncSqliteStatement;
    exec(sql: string): void;
}

export interface SqliteClientOptions {
    /** How long a statement waits for another connection's lock before failing. Default 5000 ms. */
    busyTimeoutMs?: number;
    /** Use the write-ahead log, which lets readers and a writer work at the same time. Default true; ignored by an in-memory database. */
    wal?: boolean;
}

/**
 * One queue for every SQLite client of the process, not one per client. A synchronous driver blocks the thread while it waits for
 * another connection's lock, and a transaction that is suspended at an `await` holds its lock without being able to run: a second
 * connection of the same process that waited for it would wait for ever (`database is locked` after the busy timeout). With one
 * queue, transactions of this process never overlap, whatever connection they use. Another PROCESS is not affected: it waits in
 * SQLite's own lock while this one carries on.
 */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
}

const RETURNS_ROWS = /^\s*(select|with|pragma)\b|\breturning\b/i;

/**
 * A `SqlClient` over a synchronous SQLite handle (`new DatabaseSync(file)` from `node:sqlite`, or a `better-sqlite3`
 * `Database`). Statements and transactions of this process run one at a time (see `queue`); connections of other processes to the
 * same file are kept apart by SQLite's own lock, with `busyTimeoutMs` to wait for it.
 */
export function sqliteClient(db: SyncSqliteDb, opts: SqliteClientOptions = {}): SqlClient {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 5000))}`);
    if (opts.wal ?? true) db.exec('PRAGMA journal_mode = WAL');

    const run = (sql: string, params: readonly unknown[] = []): SqlRows => {
        const bound = params.map(p => (p === undefined ? null : p));
        const stmt = db.prepare(sql);
        if (RETURNS_ROWS.test(sql)) {
            const rows = stmt.all(...bound) as Array<Record<string, unknown>>;
            return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: Number(stmt.run(...bound).changes) };
    };

    return {
        query: (sql, params) => exclusive(() => run(sql, params)),
        transaction: <T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> => exclusive(async () => {
            // IMMEDIATE takes the write lock at once: a transaction that will write must not discover it cannot half way through.
            db.exec('BEGIN IMMEDIATE');
            try {
                const result = await fn({ query: async (sql, params) => run(sql, params) });
                db.exec('COMMIT');
                return result;
            } catch (err) {
                try { db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
                throw err;
            }
        }),
    };
}
