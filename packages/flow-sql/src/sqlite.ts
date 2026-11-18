import { SqlRunJournal } from './sql-run-journal';
import type { SqlRunJournalOptions } from './sql-run-journal';
import { sqliteClient } from './client';
import type { SqliteClientOptions, SyncSqliteDb } from './client';

export type SqliteRunJournalOptions = SqlRunJournalOptions & SqliteClientOptions;

/**
 * `RunJournal` on SQLite (SPEC-0028 F1): one file, no service. Give it an open handle, `new DatabaseSync(path)` from
 * `node:sqlite` or a `better-sqlite3` `Database`, and call `migrate()` once.
 *
 * ```ts
 * import { DatabaseSync } from 'node:sqlite';
 * const journal = new SqliteRunJournal(new DatabaseSync('./flows.db'));
 * await journal.migrate();
 * await runFlow(def, { journal, runId, executor });
 * ```
 *
 * Several processes can open the same file: SQLite's lock keeps their writes apart, and the claim keeps one process per run.
 * One handle serves one journal; the caller closes it.
 */
export class SqliteRunJournal extends SqlRunJournal {
    constructor(db: SyncSqliteDb, opts: SqliteRunJournalOptions = {}) {
        super(sqliteClient(db, opts), opts);
    }
}
