import type { OrchestratorConfig } from './config.js';
import type { ExecutionResult } from './executor.js';
import type { IRunStore, RunState } from './run-store.js';
import type { OrchestratorAgentAuditEntry } from './audit.js';

/**
 * What the decision needs from the rest of the server. Passed in rather than imported so the logic
 * lives outside `server.ts` (which starts the server when loaded) and can be tested on its own.
 */
export interface GateDecisionDeps {
    audit:         { write(entry: Omit<OrchestratorAgentAuditEntry, 'ts' | 'project'>): void };
    getReflection: (vaultPath: string) => Promise<{ recordRuleOutcome(ruleId: string, outcome: 'success' | 'failure'): Promise<unknown> } | undefined>;
    buildRAG:      (config: OrchestratorConfig, dataDir: string) => Promise<{ search: (q: string) => Promise<string> } | null>;
    dataDir:       (configPath: string, config: OrchestratorConfig) => string;
    /** Continues the plan from the persisted state; runs in the background after the decision returns. */
    resume:        (runId: string, configPath: string, config: OrchestratorConfig, plan: unknown, rag: { search: (q: string) => Promise<string> } | null, priorResults: ExecutionResult[]) => Promise<void>;
    now:           () => string;
}

export interface GateDecisionInput {
    runId:      string;
    configPath: string;
    config:     OrchestratorConfig;
    store:      IRunStore;
    state:      RunState;           // must be waiting_gate
    approved:   boolean;
    notes?:     string;
}

/**
 * Records the approver's decision: rule outcomes, audit entry, run state, and — when approved —
 * resumes the plan in the background. The caller holds the per-run claim and has already checked
 * that the run is `waiting_gate`. One implementation for the MCP tool and the HTTP endpoint: they used to
 * carry two copies that drifted (the HTTP one lost the audit trail).
 */
export async function applyGateDecision(
    d: GateDecisionInput,
    deps: GateDecisionDeps,
): Promise<{ gate: NonNullable<RunState['waitingGate']> }> {
    const { runId, configPath, config, store, state, approved, notes } = d;
    const gate = state.waitingGate!;

    // Cable 2: record rule outcomes so the reflection engine tracks effectiveness
    const reflection = config.orchestrator.vault
        ? await deps.getReflection(config.orchestrator.vault.path).catch(() => undefined)
        : undefined;
    if (reflection && gate.appliedRuleIds?.length) {
        const outcome: 'success' | 'failure' = approved ? 'success' : 'failure';
        for (const ruleId of gate.appliedRuleIds) {
            reflection.recordRuleOutcome(ruleId, outcome).catch(() => { /* best-effort */ });
        }
    }

    if (!approved) {
        await store.save({
            ...state,
            status:      'failed',
            completedAt: deps.now(),
            error:       `Gate rejected by approver. Step: ${gate.stepId}. Notes: ${notes ?? '(none)'}`,
            waitingGate: undefined,
        });
        deps.audit.write({ event: 'gate.rejected', runId, task: state.task, stepId: gate.stepId, agentId: gate.agentId, error: notes ?? 'no notes' });
        return { gate };
    }

    deps.audit.write({ event: 'gate.approved', runId, task: state.task, stepId: gate.stepId, agentId: gate.agentId, extra: notes ? { notes } : undefined });
    const rag = await deps.buildRAG(config, deps.dataDir(configPath, config)).catch(() => null);

    // Mark gate as cleared, resume in background
    await store.save({ ...state, status: 'running', waitingGate: undefined });

    const priorResults: ExecutionResult[] = state.completedSteps.map(s => ({
        subtask_id:  s.stepId,
        agent_id:    s.agentId,
        task:        s.task,
        result:      s.output,
        success:     s.success,
        duration_ms: s.durationMs,
    }));

    setImmediate(() => {
        deps.resume(runId, configPath, config, state.plan, rag, priorResults).catch(async (err) => {
            const s = await store.load(runId);
            if (s) await store.save({ ...s, status: 'failed', error: String(err) });
        });
    });
    return { gate };
}
