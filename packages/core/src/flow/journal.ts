import type { FlowTransition } from './types';

/**
 * The durable record of a flow run (SPEC-0023 F3): which step the run is on, what each one produced, who owns the run.
 * It is what lets a restarted process resume without repeating a step that is done.
 *
 * It holds step outputs (the next step needs them to resume), so it is as sensitive as the conversation history. Only the
 * input preview and error texts go through the optional `redact`; the payload itself is NOT stored: whoever resumes a run
 * supplies it again.
 */

export type JournalStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'awaiting_approval' | 'interrupted';
export type JournalRunStatus = 'running' | 'paused' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled' | 'lost';

export interface JournalStep {
    status: JournalStepStatus;
    output?: string;
    error?: string;
    /** How many times the step has been started (the idempotency key carries it). */
    attempt: number;
    at: string;
    costUsd?: number;
}

export interface JournalRun {
    runId: string;
    flow: string;
    tenantId?: string;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string;
    status: JournalRunStatus;
    /** Cut and masked: never the raw payload. */
    inputPreview: string;
    steps: Record<string, JournalStep>;
    waiting?: { stepId: string; approvalId: string; criteria?: string[] };
    transitions: FlowTransition[];
    error?: string;
    costUsd?: number;
}

export type NewJournalRun = Pick<JournalRun, 'runId' | 'flow' | 'inputPreview'> & { tenantId?: string };

export interface StepPatch extends Partial<Omit<JournalStep, 'at'>> {
    transitions?: FlowTransition[];
}

export interface RunPatch {
    status?: JournalRunStatus;
    error?: string;
    costUsd?: number;
    waiting?: JournalRun['waiting'] | null;
    transitions?: FlowTransition[];
}

export interface RunJournal {
    /** Creates the run. Fails if the id already exists. */
    begin(run: NewJournalRun): Promise<void>;
    /** Writes the change BEFORE the step runs (`running`) and AFTER (`done`/`failed`). A journal that cannot write throws: the caller must not run the step. */
    step(runId: string, stepId: string, patch: StepPatch): Promise<void>;
    update(runId: string, patch: RunPatch): Promise<void>;
    /** One owner per run, with expiry. Returns the release function, or null if another owner holds it. */
    claim(runId: string, owner: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
    get(runId: string): Promise<JournalRun | undefined>;
    list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]>;
}

// ── Event log: what both implementations store, and how a run is rebuilt from it ───────────────────────────────

export type JournalEvent =
    | { kind: 'begin'; at: string; run: NewJournalRun }
    | { kind: 'step'; at: string; stepId: string; patch: StepPatch }
    | { kind: 'update'; at: string; patch: RunPatch };

const TERMINAL: JournalRunStatus[] = ['done', 'failed', 'cancelled'];

export function foldEvents(events: JournalEvent[]): JournalRun | undefined {
    let run: JournalRun | undefined;
    for (const ev of events) {
        if (ev.kind === 'begin') {
            run = { ...ev.run, startedAt: ev.at, updatedAt: ev.at, status: 'running', steps: {}, transitions: [] };
            continue;
        }
        if (!run) continue;
        run.updatedAt = ev.at;
        if (ev.kind === 'step') {
            const { transitions, ...rest } = ev.patch;
            const prev = run.steps[ev.stepId] ?? { status: 'pending', attempt: 0, at: ev.at };
            run.steps[ev.stepId] = { ...prev, ...rest, at: ev.at };
            if (transitions) run.transitions.push(...transitions);
        } else {
            const { transitions, waiting, ...rest } = ev.patch;
            Object.assign(run, rest);
            if (waiting === null) delete run.waiting; else if (waiting) run.waiting = waiting;
            if (transitions) run.transitions.push(...transitions);
            if (rest.status && TERMINAL.includes(rest.status)) run.finishedAt = ev.at;
        }
    }
    return run;
}

export function matches(run: JournalRun, filter: { status?: JournalRunStatus[]; flow?: string; tenantId?: string } = {}): boolean {
    return (!filter.status || filter.status.includes(run.status))
        && (!filter.flow || run.flow === filter.flow)
        && (!filter.tenantId || run.tenantId === filter.tenantId);
}

/** In memory: for tests and for processes whose runs need not outlive them. */
export class MemoryRunJournal implements RunJournal {
    private readonly logs = new Map<string, JournalEvent[]>();
    private readonly claims = new Map<string, { owner: string; expiresAt: number }>();

    async begin(run: NewJournalRun): Promise<void> {
        if (this.logs.has(run.runId)) throw new Error(`run "${run.runId}" already exists`);
        this.logs.set(run.runId, [{ kind: 'begin', at: new Date().toISOString(), run }]);
    }

    private log(runId: string): JournalEvent[] {
        const l = this.logs.get(runId);
        if (!l) throw new Error(`run "${runId}" does not exist`);
        return l;
    }

    async step(runId: string, stepId: string, patch: StepPatch): Promise<void> {
        this.log(runId).push({ kind: 'step', at: new Date().toISOString(), stepId, patch });
    }

    async update(runId: string, patch: RunPatch): Promise<void> {
        this.log(runId).push({ kind: 'update', at: new Date().toISOString(), patch });
    }

    async claim(runId: string, owner: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
        const cur = this.claims.get(runId);
        if (cur && cur.expiresAt > Date.now() && cur.owner !== owner) return null;
        const mine = { owner, expiresAt: Date.now() + ttlMs };
        this.claims.set(runId, mine);
        return async () => { if (this.claims.get(runId) === mine) this.claims.delete(runId); };
    }

    async get(runId: string): Promise<JournalRun | undefined> {
        const l = this.logs.get(runId);
        return l ? foldEvents(l) : undefined;
    }

    async list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]> {
        const out: JournalRun[] = [];
        for (const l of this.logs.values()) {
            const r = foldEvents(l);
            if (r && matches(r, filter)) out.push(r);
        }
        return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }
}
