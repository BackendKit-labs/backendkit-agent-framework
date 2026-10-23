import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** `lost`: Hermes started the run and, after a restart, the agent no longer knows it. */
export type StoredStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'lost';

export interface RunRecord {
    runId: string;
    agentId: string;
    capability: string;
    /** The input with secret-looking values masked and cut to a short preview. Never the raw input. */
    inputPreview: string;
    status: StoredStatus;
    /** What the agent calls the run, to ask about it again after a restart. */
    connectorRunId?: string;
    principalId: string;
    traceId?: string;
    startedAt: string;
    finishedAt?: string;
    /** The result after guardrails, as text. */
    output?: string;
    error?: string;
}

export interface RunStore {
    put(record: RunRecord): Promise<void>;
    get(runId: string): RunRecord | undefined;
    update(runId: string, patch: Partial<Omit<RunRecord, 'runId'>>): Promise<RunRecord | undefined>;
    list(filter?: { agentId?: string; status?: StoredStatus[] }): RunRecord[];
    /** Waits until everything written so far is durable. */
    flush?(): Promise<void>;
}

export const ACTIVE: readonly StoredStatus[] = ['pending', 'running'];

/**
 * Runs in a JSON file. Every change is written to a temp file and renamed over the real one, one write at a time, so
 * a crash leaves the previous complete file. Reads come from memory.
 */
export class JsonRunStore implements RunStore {
    private readonly runs = new Map<string, RunRecord>();
    private chain: Promise<unknown> = Promise.resolve();

    constructor(private readonly file: string | undefined, private readonly maxRecords = 5000) {
        if (file && existsSync(file)) {
            const parsed = JSON.parse(readFileSync(file, 'utf8')) as { runs?: RunRecord[] };
            for (const r of parsed.runs ?? []) this.runs.set(r.runId, r);
        }
    }

    async put(record: RunRecord): Promise<void> {
        this.runs.set(record.runId, { ...record });
        this.prune();
        await this.persist();
    }

    get(runId: string): RunRecord | undefined {
        const r = this.runs.get(runId);
        return r ? { ...r } : undefined;
    }

    async update(runId: string, patch: Partial<Omit<RunRecord, 'runId'>>): Promise<RunRecord | undefined> {
        const current = this.runs.get(runId);
        if (!current) return undefined;
        const next = { ...current, ...patch };
        this.runs.set(runId, next);
        await this.persist();
        return { ...next };
    }

    list(filter: { agentId?: string; status?: StoredStatus[] } = {}): RunRecord[] {
        return [...this.runs.values()]
            .filter(r => (!filter.agentId || r.agentId === filter.agentId) && (!filter.status || filter.status.includes(r.status)))
            .map(r => ({ ...r }));
    }

    /** Waits for every write started so far. */
    flush(): Promise<void> { return this.chain.then(() => undefined); }

    /** Finished runs are the first to go when the store is full; running ones are never dropped. */
    private prune(): void {
        if (this.runs.size <= this.maxRecords) return;
        const finished = [...this.runs.values()].filter(r => !ACTIVE.includes(r.status)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        for (const r of finished.slice(0, this.runs.size - this.maxRecords)) this.runs.delete(r.runId);
    }

    private persist(): Promise<void> {
        if (!this.file) return Promise.resolve();
        const file = this.file;
        const write = async () => {
            mkdirSync(dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify({ runs: [...this.runs.values()] }), 'utf8');
            // Windows can refuse a rename while another process (an antivirus, an indexer) holds the target for a moment.
            for (let attempt = 0; ; attempt++) {
                try { await rename(tmp, file); return; }
                catch (err) {
                    const code = (err as NodeJS.ErrnoException).code;
                    if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
                    await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
                }
            }
        };
        const next = this.chain.then(write, write);
        this.chain = next.catch(() => undefined);
        return next;
    }
}
