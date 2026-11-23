---
title: Background jobs
description: Let a tool start slow work (a build, a server, a report) and return at once, so the agent keeps going and reads the result when it needs it.
---

A tool call normally blocks the agent: it starts, finishes, and only then does the model see the result. For work that takes minutes (a build, a test suite, a dev server, a report) that is the wrong shape. A **background job** lets a tool start the work, return an id **immediately**, and leave the work running. The agent reads the output when it wants, or cancels the job.

## Turn it on

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  // ...providers, agents, tools
  jobs: true,                         // defaults, or pass options (below)
});
```

With `jobs` on, the engine:

- registers three tools, **`job_output`**, **`job_list`** and **`job_kill`**. Add them to the `allowedTools` of the agents that should use them;
- gives every tool a `ctx.jobs` registry, so your own tools can start jobs;
- **tells the model when a job finishes**: on the next iteration it receives `[Background job report-1 finished (done). Use job_output to read it.]`, once per job;
- cancels every running job when the engine stops.

For the coding agent it is one option: `createCodingEngine({ ..., jobs: true })` gives `run_command` a `background: true` argument and gives the agents that can run commands the three job tools.

## A tool that starts a job

```ts
import { defineTool, z } from '@backendkit-labs/agent-core';

const startReport = defineTool({
  name: 'start_report',
  description: 'Start generating the monthly report in the background',
  input: z.object({ month: z.string() }),
  execute: async ({ month }, ctx) => {
    const job = ctx.jobs!.start({
      kind: 'report',                    // the id is "<kind>-<n>": report-1, report-2...
      owner: ctx.agentId,                // only this agent can read or cancel it
      run: async (signal, append) => {
        for (const part of ['sales', 'costs', 'summary']) {
          if (signal.aborted) throw new Error('cancelled');
          append(`${month}: ${part} ready\n`);      // what job_output will show
          await new Promise(r => setTimeout(r, 1000));   // the slow work
        }
        return `report for ${month} complete`;      // becomes the job's summary
      },
    });
    return `Started ${job.id}. Read it with job_output.`;
  },
});
```

The agent's allowed tools: `['start_report', 'job_output', 'job_list', 'job_kill']`. The model calls `start_report`, gets `report-1` back at once, and can do other work meanwhile.

## What the model sees

| Tool | What it does |
|---|---|
| `job_output { id, since_offset?, wait_ms? }` | Returns `[report-1 running \| next_offset=21]` and the text. Pass the `next_offset` of the last read as `since_offset` to get only what is new. `wait_ms` (up to 60 s) waits for new output or for the end of the job before answering. |
| `job_list {}` | The agent's own jobs, running and recently finished. |
| `job_kill { id }` | Cancels a running job. |

A finished job answers `job_output` with `finished` and its status (`done`, `failed` or `cancelled`) and summary.

## Rules that keep it safe

- **A job belongs to the agent that started it.** `get`, `output`, `cancel` and `list` take the owner, and another agent gets "not found". An operator sees all of them through [run control](../run-control/).
- **Limits.** 8 running jobs per owner by default; the next `start` throws `JobLimitError` (`code: 'JOB_LIMIT_REACHED'`) and the tool reports it to the model.
- **Bounded memory.** Each job keeps the last 64 KB of its output (offsets stay absolute, so `since_offset` still works; text that scrolled out is gone). A finished job stays readable for 10 minutes, then it is deleted.
- **Cancel is cooperative.** `job_kill` aborts the `signal` you were given and waits up to 2 s for the job to wind down; then the job is marked `cancelled` whether or not it stopped. Make `run` watch `signal` (or pass it to what it spawns, such as `child_process`).
- **A cancelled job is `cancelled`, not `failed`**, even if it died with an error because its process was killed.
- **A job outlives the turn, not the process.** Jobs live in memory. If the engine or the process stops, they are cancelled. For work that must survive a restart use a [flow with a journal](../flows/).

## Options

| Option | Default | What |
|---|---|---|
| `maxPerOwner` | `8` | Running jobs per agent. |
| `retainOutputBytes` | `64 KB` | Output kept per job. |
| `retainFinishedMs` | `10 min` | How long a finished job stays readable. |
| `cancelGraceMs` | `2000` | How long a cancel waits for the job to wind down. |

```ts
createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, /* ... */ jobs: { maxPerOwner: 3, retainFinishedMs: 60_000 } });
```

## Using the registry without an engine

`createJobRegistry(options)` is the registry on its own, for a program that wants the same behaviour:

```ts
import { createJobRegistry } from '@backendkit-labs/agent-core';

const jobs = createJobRegistry();
const job = jobs.start({ kind: 'build', owner: 'ci', run: async (signal, append) => { append('compiling\n'); return 'build ok'; } });

let out = await jobs.output(job.id, 'ci', { waitMs: 1000 });                         // { text, nextOffset, done }
out = await jobs.output(job.id, 'ci', { sinceOffset: out.nextOffset, waitMs: 1000 });
await jobs.cancel(job.id, 'ci');                                                       // true if it was running
jobs.list('ci');          // this owner's jobs
jobs.drainFinished('ci'); // jobs that ended and were not reported yet
```
