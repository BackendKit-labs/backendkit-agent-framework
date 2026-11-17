---
title: audit-desk
description: An exhaustive audit of expense records as a durable flow, tested against a real Redis with real processes and a hard kill.
---

An **exhaustive audit** reads every record. That is not what a language model is for, so the scanning is deterministic computation, and a model would come in only where judgment or prose is needed (the doubtful cases, the report). The records are synthetic and seeded, with anomalies **planted** so the audit can be scored (nothing missed, nothing invented) and decoys (monthly subscriptions that look like duplicates and are not).

```
shard-000 ┐
shard-001 ├─ scanner x N (in parallel, on workers) ─> merge ─> verify ─> report
   ...    ┘     every record, one shard each          cross-shard  re-reads the   only if something was
                                                      duplicates   raw records    confirmed; a person
                                                      and splits   (not the       approves it
                                                                   scanner)
```

| Step | What it does |
|---|---|
| `shard-NNN` | Reads every record of its shard: outliers, missing approval, self approval. |
| `merge` | What only shows **across** shards: duplicates, and purchases split to dodge the approval limit. |
| `verify` | Does not trust the scanner: re-reads the raw records and clears the subscriptions. |
| `report` | Runs only if something was confirmed (`when: matches '^VERIFY: [1-9]\d* CONFIRMED'`) and a person approves. A clean book asks nobody. |

## Run it

```bash
npm run smoke          # 8 checks, offline
npm run audit          # one audit in this process: precision, recall and the report

npm run redis:up       # a throwaway Redis in a container
npm run redis:check    # 11 checks with real processes, including a hard kill
npm run redis:down

npm run ndjson:check   # the single-host journal: kill the orchestrator, another process takes over at once
```

## What it proved

- **The Redis journal, for the first time against a real Redis:** 40 simultaneous `begin`, 300 appends and 30 simultaneous claims, claim renewal, expiry and resume after a `SIGKILL` of the orchestrator.
- **Workers in other processes** took the steps through BullMQ.
- **Two real bugs, fixed in the framework:**
  1. The queue executor could lose the completion of an instant step on a queue used for the first time (BullMQ announces the end of a job on an event stream and an announcement made before a new reader starts is never delivered). It now also looks at the job itself every `pollMs`.
  2. The file journal failed with "too much contention" when more than about 20 steps finished at once, even in one process. Appends of a run are now serialised and cross-process contention retries with jitter.
- It measured the single-host journal against Redis: after a kill, a run owned by a dead process was claimed in 10-18 ms, where Redis has to wait for the claim to expire.

The mock tests could not have found either bug. A real Redis, real processes and a real kill did.

Guides it supports: [flows across processes](../../guides/flows-across-processes/), [a durable flow with an approval](../../guides/durable-flow-with-approval/).
