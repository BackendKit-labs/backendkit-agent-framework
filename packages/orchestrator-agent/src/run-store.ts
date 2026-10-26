import * as fs   from 'node:fs';
import * as path from 'node:path';
import { atomicWriteSync } from '@backendkit-labs/agent-core';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'waiting_gate' | 'complete' | 'failed';

export interface StepResult {
    stepId:     string;
    agentId:    string;
    task:       string;
    output:     string;
    success:    boolean;
    durationMs: number;
}

export interface GatePending {
    gateId:          string;
    stepId:          string;
    agentId:         string;
    output:          string;
    criteria:        string[];
    requestedAt:     string;
    appliedRuleIds?: string[];
}

export interface RunState {
    runId:           string;
    task:            string;
    configPath:      string;
    status:          RunStatus;
    startedAt:       string;
    updatedAt:       string;
    completedAt?:    string;
    plan?:           unknown;
    completedSteps:  StepResult[];
    currentStep?:    { stepId: string; agentId: string; startedAt: string };
    waitingGate?:    GatePending;
    vaultNotePath?:  string;
    finalReport?:    string;
    error?:          string;
}

// ── Interface (implemented by both DiskRunStore and RedisRunStore) ─────────────

export interface IRunStore {
    newRunId(): string;
    save(state: RunState): Promise<void>;
    load(runId: string): Promise<RunState | null>;
    list(): Promise<RunState[]>;
    prune(maxAgeDays?: number): Promise<number>;
    /**
     * Claims a run for a gate decision across processes: the release function, or null if another process
     * (or call) holds it. The claim expires on its own after `ttlMs` so a crashed holder cannot block a run
     * forever. Optional: a store without it relies on the in-process claim only.
     */
    claim?(runId: string, ttlMs?: number): Promise<(() => Promise<void>) | null>;
}

// ── Disk-based implementation ─────────────────────────────────────────────────

export class RunStore implements IRunStore {
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
        fs.mkdirSync(this.dir, { recursive: true });
    }

    newRunId(): string {
        return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async save(state: RunState): Promise<void> {
        const updated: RunState = { ...state, updatedAt: new Date().toISOString() };
        atomicWriteSync(path.join(this.dir, `${state.runId}.json`), JSON.stringify(updated, null, 2));
    }

    async load(runId: string): Promise<RunState | null> {
        // runId reaches here from MCP tool args; never let it escape the store directory.
        if (!/^[A-Za-z0-9_-]+$/.test(runId)) return null;
        try {
            return JSON.parse(
                fs.readFileSync(path.join(this.dir, `${runId}.json`), 'utf-8'),
            ) as RunState;
        } catch {
            return null;
        }
    }

    async list(): Promise<RunState[]> {
        let files: string[];
        try {
            files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
        } catch {
            return [];
        }
        const runs: RunState[] = [];
        for (const file of files) {
            try {
                const state = JSON.parse(
                    fs.readFileSync(path.join(this.dir, file), 'utf-8'),
                ) as RunState;
                runs.push(state);
            } catch { /* skip corrupt files */ }
        }
        return runs.sort((a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
    }

    /**
     * A claim is a `<runId>.claim` file created with the exclusive flag, so two processes on the same directory
     * cannot both create it. One older than `ttlMs` belongs to a crashed holder and is taken over.
     */
    async claim(runId: string, ttlMs = 5 * 60_000): Promise<(() => Promise<void>) | null> {
        if (!/^[A-Za-z0-9_-]+$/.test(runId)) return null;
        const file = path.join(this.dir, `${runId}.claim`);
        const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                fs.writeFileSync(file, token, { flag: 'wx' });
                return async () => {
                    try {
                        // free only our own claim: after the ttl another process may have taken the file over
                        if (fs.readFileSync(file, 'utf-8') === token) fs.unlinkSync(file);
                    } catch { /* already gone */ }
                };
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
                try {
                    if (Date.now() - fs.statSync(file).mtimeMs <= ttlMs) return null;
                    fs.unlinkSync(file); // stale: its holder is gone
                } catch { /* released between the check and here: try again */ }
            }
        }
        return null;
    }

    async prune(maxAgeDays = 30): Promise<number> {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        let removed = 0;
        for (const run of await this.list()) {
            if (run.status !== 'complete' && run.status !== 'failed') continue;
            if (new Date(run.startedAt).getTime() < cutoff) {
                try {
                    fs.unlinkSync(path.join(this.dir, `${run.runId}.json`));
                    removed++;
                } catch { /* ignore */ }
            }
        }
        return removed;
    }
}
