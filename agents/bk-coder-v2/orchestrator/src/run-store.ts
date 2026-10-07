import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { ExecutionReport } from './command-runner.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'waiting_gate' | 'complete' | 'failed';

export type QaVerdict = 'GO' | 'NO_GO' | 'CONDITIONAL';

/**
 * Phase-runner state for SDD execution. Tracks the phase pointer over the
 * project's ROADMAP.md so a run can implement → QA → gate → advance/rework,
 * surviving restarts and gate pauses.
 */
export interface PhaseState {
    currentPhase:  number;        // 1-indexed pointer into the roadmap phases
    totalPhases:   number;
    phaseTitle:    string;        // title of the current phase
    stage:         'implement' | 'qa' | 'security' | 'infra' | 'done';
    reworkCount:   number;        // times the current phase was reworked
    verdict?:      QaVerdict;     // last QA verdict for the current phase
    qaFindings?:   string;        // QA findings injected into the next rework
    phaseTitles:   string[];      // all phase titles for display
    /** QA findings from every rework of the CURRENT phase, oldest first — feeds the
     *  stuck-loop triage once a phase has failed enough times in a row (see triage.ts).
     *  Reset when the phase is approved and the pointer advances. */
    reworkHistory?: string[];
}

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
    // Phase-runner gates carry the QA verdict so the approver sees GO/NO_GO
    // and can choose approve (advance) / rework (re-implement) / reject (stop).
    verdict?:        QaVerdict;
    phase?:          number;
    allowRework?:    boolean;
    // Real build+test results from the phase runner, surfaced to QA on-demand.
    executionReport?: ExecutionReport;
}

export interface RunState {
    runId:           string;
    task:            string;
    configPath:      string;
    projectRoot?:    string;   // active project root at the time the run was created
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
    // Present when the run uses the phase-runner (SDD mode) instead of a static plan.
    phaseState?:     PhaseState;
}

// ── Interface (implemented by both DiskRunStore and RedisRunStore) ─────────────

export interface IRunStore {
    newRunId(): string;
    save(state: RunState): Promise<void>;
    load(runId: string): Promise<RunState | null>;
    list(): Promise<RunState[]>;
    prune(maxAgeDays?: number): Promise<number>;
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
        fs.writeFileSync(
            path.join(this.dir, `${state.runId}.json`),
            JSON.stringify(updated, null, 2),
            'utf-8',
        );
    }

    async load(runId: string): Promise<RunState | null> {
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
