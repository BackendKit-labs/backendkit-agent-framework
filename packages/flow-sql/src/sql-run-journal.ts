import { randomBytes } from 'node:crypto';
import { foldEvents, JournalConflict } from '@backendkit-labs/agent-core';
import type {
    JournalEvent, JournalRun, JournalRunStatus, NewJournalRun, RunJournal, RunPatch, StepPatch,
} from '@backendkit-labs/agent-core';
import type { SqlClient } from './client';

/**
 * `RunJournal` on SQL (SPEC-0028). The state of a run is the fold of an append-only event log, as in the file, ndjson and Redis
 * journals, so what a run is does not depend on where it is kept.
 *
 * - `<prefix>run_events(run_id, seq, recorded_at, kind, payload)`: the log. `(run_id, seq)` is the key, which is what makes a second
 *   writer visible (see below).
 * - `<prefix>runs(run_id, flow, tenant_id, status, started_at, updated_at)`: an index for `list`, written in the same
 *   transaction as the event that changes it.
 * - `<prefix>run_claims(run_id, owner, token, expires_at)`: one owner per run, with expiry.
 *
 * **One writer per run.** A journal object remembers the sequence number of the last event it wrote for a run. If another
 * object wrote in between, the next insert collides on `(run_id, seq)` and fails with `JournalConflict`: the run is no longer
 * the caller's, and `runFlow` stops (SPEC-0024). An acknowledged write is never lost.
 *
 * It works on any database whose `SqlClient` runs `INSERT ... ON CONFLICT DO NOTHING / DO UPDATE ... WHERE`.
 */
export interface SqlRunJournalOptions {
    /** Prefix of the three table names. Letters, digits and `_`, starting with a letter or `_`. Default `flow_`. */
    tablePrefix?: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PREFIX = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

export class SqlRunJournal implements RunJournal {
    protected readonly events: string;
    protected readonly runs: string;
    protected readonly claims: string;
    /** The sequence number of the last event this object wrote or saw written by itself, per run. */
    private readonly tails = new Map<string, number>();
    /** Writes of one run, one after another: an object's own concurrent writes must not collide with each other. */
    private readonly chains = new Map<string, Promise<unknown>>();

    constructor(protected readonly client: SqlClient, opts: SqlRunJournalOptions = {}) {
        const prefix = opts.tablePrefix ?? 'flow_';
        // A table name cannot be a bound parameter, so the prefix is checked, never escaped.
        if (!PREFIX.test(prefix)) throw new Error(`invalid table prefix "${prefix}"`);
        this.events = `${prefix}run_events`;
        this.runs = `${prefix}runs`;
        this.claims = `${prefix}run_claims`;
    }

    /** Creates the tables and indexes if they do not exist. Safe to call on every start. The journal never creates them by itself. */
    async migrate(): Promise<void> {
        await this.client.transaction(async tx => {
            for (const sql of this.ddl()) await tx.query(sql);
        });
    }

    /** The statements `migrate` runs, for an integrator who applies migrations with their own tool. */
    ddl(): string[] {
        return [
            `CREATE TABLE IF NOT EXISTS ${this.events} (
                run_id TEXT NOT NULL,
                seq BIGINT NOT NULL,
                recorded_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY (run_id, seq)
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.runs} (
                run_id TEXT PRIMARY KEY,
                flow TEXT NOT NULL,
                tenant_id TEXT,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS ${this.runs}_flow_idx ON ${this.runs} (flow, started_at)`,
            `CREATE INDEX IF NOT EXISTS ${this.runs}_status_idx ON ${this.runs} (status, started_at)`,
            `CREATE INDEX IF NOT EXISTS ${this.runs}_tenant_idx ON ${this.runs} (tenant_id, started_at)`,
            `CREATE TABLE IF NOT EXISTS ${this.claims} (
                run_id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                token TEXT NOT NULL,
                expires_at BIGINT NOT NULL
            )`,
        ];
    }

    async begin(run: NewJournalRun): Promise<void> {
        this.checkId(run.runId);
        const at = new Date().toISOString();
        const ev: JournalEvent = { kind: 'begin', at, run };
        await this.serial(run.runId, () => this.client.transaction(async tx => {
            const created = await tx.query(
                `INSERT INTO ${this.runs} (run_id, flow, tenant_id, status, started_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)
                 ON CONFLICT (run_id) DO NOTHING`,
                [run.runId, run.flow, run.tenantId ?? null, at, at],
            );
            if (created.rowCount !== 1) throw new Error(`run "${run.runId}" already exists`);
            await tx.query(
                `INSERT INTO ${this.events} (run_id, seq, recorded_at, kind, payload) VALUES (?, 0, ?, 'begin', ?)`,
                [run.runId, at, JSON.stringify(ev)],
            );
        }));
        this.tails.set(run.runId, 0);
    }

    async step(runId: string, stepId: string, patch: StepPatch): Promise<void> {
        await this.append(runId, { kind: 'step', at: new Date().toISOString(), stepId, patch });
    }

    async update(runId: string, patch: RunPatch): Promise<void> {
        await this.append(runId, { kind: 'update', at: new Date().toISOString(), patch });
    }

    async claim(runId: string, owner: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
        this.checkId(runId);
        const now = Date.now();
        const token = randomBytes(8).toString('hex');
        // One statement: take the claim if it is free, expired or already this owner's. Another owner's valid claim leaves it
        // untouched and the statement changes no row. A renewal replaces the token, so the previous release no longer matches.
        const taken = await this.client.query(
            `INSERT INTO ${this.claims} (run_id, owner, token, expires_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (run_id) DO UPDATE SET owner = excluded.owner, token = excluded.token, expires_at = excluded.expires_at
             WHERE ${this.claims}.expires_at <= ? OR ${this.claims}.owner = excluded.owner`,
            [runId, owner, token, now + Math.max(1, Math.ceil(ttlMs)), now],
        );
        if (taken.rowCount !== 1) return null;
        return async () => {
            await this.client.query(`DELETE FROM ${this.claims} WHERE run_id = ? AND token = ?`, [runId, token]);
        };
    }

    async get(runId: string): Promise<JournalRun | undefined> {
        this.checkId(runId);
        const res = await this.client.query(`SELECT payload FROM ${this.events} WHERE run_id = ? ORDER BY seq`, [runId]);
        if (res.rows.length === 0) return undefined;
        return foldEvents(res.rows.map(r => JSON.parse(String(r.payload)) as JournalEvent));
    }

    async list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]> {
        if (filter?.status && filter.status.length === 0) return [];
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter?.flow !== undefined) { where.push('r.flow = ?'); params.push(filter.flow); }
        if (filter?.tenantId !== undefined) { where.push('r.tenant_id = ?'); params.push(filter.tenantId); }
        if (filter?.status) { where.push(`r.status IN (${filter.status.map(() => '?').join(', ')})`); params.push(...filter.status); }
        const res = await this.client.query(
            `SELECT e.run_id AS run_id, e.payload AS payload
             FROM ${this.events} e JOIN ${this.runs} r ON r.run_id = e.run_id
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY r.started_at, e.run_id, e.seq`,
            params,
        );
        const byRun = new Map<string, JournalEvent[]>();
        for (const row of res.rows) {
            const id = String(row.run_id);
            const events = byRun.get(id) ?? [];
            events.push(JSON.parse(String(row.payload)) as JournalEvent);
            byRun.set(id, events);
        }
        const out: JournalRun[] = [];
        for (const events of byRun.values()) {
            const run = foldEvents(events);
            if (run) out.push(run);
        }
        return out;
    }

    private async append(runId: string, ev: JournalEvent): Promise<void> {
        this.checkId(runId);
        await this.serial(runId, async () => {
            let seq = 0;
            try {
                await this.client.transaction(async tx => {
                    let tail = this.tails.get(runId);
                    if (tail === undefined) {
                        // First write by this object: continue after whatever the log holds now.
                        const max = await tx.query(`SELECT MAX(seq) AS seq FROM ${this.events} WHERE run_id = ?`, [runId]);
                        const found = max.rows[0]?.seq;
                        if (found === null || found === undefined) throw new Error(`run "${runId}" does not exist`);
                        tail = Number(found);
                    }
                    seq = tail + 1;
                    const written = await tx.query(
                        `INSERT INTO ${this.events} (run_id, seq, recorded_at, kind, payload) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT (run_id, seq) DO NOTHING`,
                        [runId, seq, ev.at, ev.kind, JSON.stringify(ev)],
                    );
                    if (written.rowCount !== 1) {
                        throw new JournalConflict(runId, `the journal of "${runId}" changed under this writer: someone else wrote to it`);
                    }
                    const status = ev.kind === 'update' ? ev.patch.status ?? null : null;
                    await tx.query(`UPDATE ${this.runs} SET updated_at = ?, status = COALESCE(?, status) WHERE run_id = ?`, [ev.at, status, runId]);
                });
            } catch (err) {
                if (err instanceof JournalConflict) this.tails.delete(runId);
                throw err;
            }
            this.tails.set(runId, seq);
        });
    }

    private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.chains.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        const tracked = next.catch(() => undefined);
        this.chains.set(key, tracked);
        void tracked.then(() => { if (this.chains.get(key) === tracked) this.chains.delete(key); });
        return next;
    }

    private checkId(id: string): void {
        if (!ID.test(id)) throw new Error(`invalid run id "${id}"`);
    }
}
