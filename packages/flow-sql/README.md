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

It takes a `pg.Pool` (anything with `query` and `connect`; `pg` is not a dependency of this package). Each transaction uses its own connection from the pool, so the transactions of one process run in parallel and Postgres keeps them apart. `schema` is optional.

**Tested with** Postgres 14, 15, 16, 17 and 18; behind pgbouncer 1.22 in `transaction` mode (a transaction keeps its server connection from `BEGIN` to `COMMIT`, which is all it needs); and over SSL with `sslmode=verify-full`. Postgres 14 and older are untested. In `statement` mode it does not work: it refuses transactions (`transaction blocks not allowed in statement pooling mode`).

**Another driver** needs a `SqlClient`: `query` and `transaction`, with `?` placeholders (`toPositional` converts them). This one, for [`postgres`](https://www.npmjs.com/package/postgres) (postgres.js), passes the whole journal battery:

```ts
import postgres from 'postgres';
import { SqlRunJournal, toPositional } from '@backendkit-labs/agent-flow-sql';
import type { SqlClient } from '@backendkit-labs/agent-flow-sql';

function postgresJsClient(sql: postgres.Sql): SqlClient {
  const run = async (q: postgres.Sql, text: string, params: readonly unknown[] = []) => {
    const res = await q.unsafe(toPositional(text), params.map(p => (p === undefined ? null : p)) as never[]);
    return { rows: Array.from(res) as Array<Record<string, unknown>>, rowCount: res.count ?? res.length };
  };
  return {
    query: (text, params) => run(sql, text, params),
    transaction: fn => sql.begin(tx => fn({ query: (text, params) => run(tx as never, text, params) })) as never,
  };
}

const journal = new SqlRunJournal(postgresJsClient(postgres(url)), { schema: 'flows' });
await journal.migrate();   // with a schema, create it first: CREATE SCHEMA IF NOT EXISTS flows
```

`migrate()` is explicit: the journal never creates tables by itself. `journal.ddl()` returns the statements if you apply migrations with your own tool, and `tablePrefix` (default `flow_`) keeps several journals in one database apart.

## A complete example: a flow that survives a crash

One file. A four-step nightly close runs in a first "process" that dies in the third step, and a second "process" with a **new connection to the same database file** finishes it, without repeating the two steps that were already done. It needs Node 22.13+ and nothing else (no server, no key). Save it as `close.ts` and run it with `npx tsx close.ts`.

```bash
npm install @backendkit-labs/agent-core @backendkit-labs/agent-flow-sql
npm install -D typescript tsx
```

```ts
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFlow, runFlow } from '@backendkit-labs/agent-core';
import { SqliteRunJournal } from '@backendkit-labs/agent-flow-sql';

const flow = parseFlow(`
flow: nightly-close
trigger: { type: manual }
steps:
  - id: export-sales
    agent: sales
    prompt: "Export the sales of {{payload.day}}"
  - id: export-costs
    agent: finance
    prompt: "Export the costs of {{payload.day}}"
  - id: reconcile
    agent: finance
    prompt: "Reconcile sales and costs"
    after: [export-sales, export-costs]
  - id: send
    agent: comms
    prompt: "Send the summary"
    after: [reconcile]
`);

const file = join(mkdtempSync(join(tmpdir(), 'flows-')), 'flows.db');
const executed: string[] = [];
let breakReconcile = true;                       // the first process "crashes" in the third step

const executor = {
  run: async (step: { id: string; agent: string }) => {
    if (step.id === 'reconcile' && breakReconcile) throw new Error('the process was killed');
    executed.push(step.id);
    return { content: `${step.agent} did ${step.id}` };
  },
};
const options = { executor, payload: { day: '2026-11-21' }, runId: 'close-2026-11-21' };

// Process 1: opens the database, runs the flow, and the third step fails.
const journal1 = new SqliteRunJournal(new DatabaseSync(file));
await journal1.migrate();                        // creates the tables if they do not exist; safe on every start
const first = await runFlow(flow, { ...options, journal: journal1 });
console.log('process 1:', first.status, executed);

// Process 2: a new connection to the SAME file (a restart, a deploy, another machine with the same database).
breakReconcile = false;
const journal2 = new SqliteRunJournal(new DatabaseSync(file));
await journal2.migrate();
const second = await runFlow(flow, { ...options, journal: journal2 });
console.log('process 2:', second.status, executed);

// What the database knows about the run.
const run = await journal2.get('close-2026-11-21');
console.log(run?.status, Object.entries(run?.steps ?? {}).map(([id, s]) => `${id}:${s.status}`).join(" "));
console.log((await journal2.list({ status: ['done'] })).map(r => r.runId));
```

It prints:

```text
process 1: failed [ 'export-sales', 'export-costs' ]
process 2: completed [ 'export-sales', 'export-costs', 'reconcile', 'send' ]
done export-sales:done export-costs:done reconcile:done send:done
[ 'close-2026-11-21' ]
```

What happened, step by step:

1. **Two steps ran in parallel** (`export-sales`, `export-costs` have no `after`). Each finished, and the journal recorded it in the database.
2. **`reconcile` failed**, the way a killed process would. The run is `failed` and `send` never started. The two finished steps are safe in the file.
3. **A second journal opened the same file.** `runFlow` with the **same `runId`** read the run from the database and saw two steps `done`: it ran **only `reconcile` and `send`**. `executed` lists each export once.
4. **The database knows the run.** `journal.get(runId)` returns its status and every step; `journal.list({ status: ['done'] })` lists runs oldest first (also filterable by `flow` and `tenantId`).

The pieces to copy into your own program:

- **`runId` is yours to choose, and it is what makes a run resumable.** Use something that names the work (`close-2026-11-21`), not a random id: the same day's close run twice is then one run, not two.
- **`migrate()` on every start** is safe: it creates the tables if they do not exist and does nothing otherwise.
- **Pass the payload again on resume.** The journal stores only a cut and masked preview of it, so `payload` goes in `options` both times.
- **For Postgres** the only lines that change are the two that build the journal: `new PostgresRunJournal(new Pool({ connectionString }))`. The flow, the executor and the `runFlow` calls stay the same.

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
