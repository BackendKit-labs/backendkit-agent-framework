# @backendkit-labs/agent-flow-sql

A `RunJournal` on SQL for the flows of [`@backendkit-labs/agent-core`](https://www.npmjs.com/package/@backendkit-labs/agent-core): the runs of a flow survive the process, and any process that shares the database can resume them. **SQLite and Postgres** ([SPEC-0028](../../docs/specs/SPEC-0028-journals-en-sqlite-y-postgres.md)).

Use it when you want one file and no service (SQLite), or the database you already run (Postgres). For one process that must not lose a run, `NdjsonRunJournal` in core is enough; this package is for runs that several processes or a restarted process share.

## Install

```bash
npm install @backendkit-labs/agent-flow-sql @backendkit-labs/agent-core
```

Node 22.13 or newer (`engines`). There is no driver dependency: you give it an open handle, `node:sqlite` (built in) or `better-sqlite3` (any handle with `prepare(sql).all/run` and `exec`).

## Use

```ts
import { DatabaseSync } from 'node:sqlite';
import { runFlow, loadFlow } from '@backendkit-labs/agent-core';
import { SqliteRunJournal } from '@backendkit-labs/agent-flow-sql';

const journal = new SqliteRunJournal(new DatabaseSync('./flows.db'));
await journal.migrate();                       // creates the tables if they do not exist; safe on every start

await runFlow(await loadFlow('./flows/invoices.yaml'), { journal, runId: 'invoices-2026-11', executor });
// after a crash or a deploy: the same call resumes; steps that are done are not run again
```

### Postgres

```ts
import { Pool } from 'pg';
import { PostgresRunJournal } from '@backendkit-labs/agent-flow-sql';

const journal = new PostgresRunJournal(new Pool({ connectionString }), { schema: 'flows' });
await journal.migrate();                       // CREATE SCHEMA and the tables, if they do not exist
```

It takes a `pg.Pool` (anything with `query` and `connect`; `pg` is not a dependency of this package). Each transaction uses its own connection from the pool, so the transactions of one process run in parallel and Postgres keeps them apart. `schema` is optional. For another driver, write a `SqlClient` (`query` and `transaction`, with `?` placeholders): `pgClient` is about twenty lines.

`migrate()` is explicit: the journal never creates tables by itself. `journal.ddl()` returns the statements if you apply migrations with your own tool, and `tablePrefix` (default `flow_`) keeps several journals in one database apart.

## What it guarantees

- **A run is a log of events**, the same as the file, ndjson and Redis journals: `get` folds it, so what a run is does not depend on where it is kept.
- **One owner per run** (`claim`, with expiry). Of several processes racing for a run, one wins; the others get `FlowClaimError` from `runFlow`.
- **One writer per run.** If another journal object wrote to a run after yours did, your next write fails with `JournalConflict` and the flow stops: the run is no longer yours. A write that was acknowledged is never lost.
- **`list` is oldest first** and filters by status, flow and tenant through an index that is updated in the same transaction as the event.
- It passes the shared journal battery of core (`@backendkit-labs/agent-core/testing`), and it is tested with real processes over one file.

## Notes

- **`node:sqlite` is still marked as under development in Node.** The package only needs the small `prepare` / `exec` interface, so a `better-sqlite3` handle works the same way: the journal passes its tests over both, with `better-sqlite3` 12.11 and 13.2.
- **Transactions of one process are serialized.** A synchronous SQLite driver blocks the thread while it waits for another connection's lock, and a transaction suspended at an `await` would never release it; so every transaction of the process goes through one queue. Other processes wait in SQLite's own lock (`busyTimeoutMs`, default 5000) and are not affected.
- **The claim expires by the clock of the process that takes it**, in both databases. Keep the TTL well above the clock difference between your processes; a running flow renews its claim every third of the TTL.
- **WAL is on by default** (`wal: false` to turn it off), so readers do not wait for the writer.
- **Retention is yours.** The journal keeps every run; delete finished ones with your own job (`DELETE` from the three tables by `run_id`).
- The payload of a run is not stored, only a cut and masked preview (`redact` in `runFlow`): pass it again when you resume.
