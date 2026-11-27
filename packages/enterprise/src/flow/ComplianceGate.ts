/**
 * ComplianceGate — verifiable compliance with evaluator/executor separation.
 *
 * Fixes the 4 gaps of the design-agent model (ADR-3):
 *   1. Evaluator MUST differ from the executor (runtime enforcement)
 *   2. Every criterion evaluated individually with required evidence when configured
 *   3. Every state mutation appends to an immutable log — no silent bypasses
 *   4. Record persisted to vault (/auditoria/{flow}/{run}/) — versionable + RAG-consultable
 */

import * as path from 'path';
import { hashArgs } from '@backendkit-labs/agent-core';
import type { AuditEvent, AuditSink } from '@backendkit-labs/agent-core';
import { VaultWriter } from '../rag/VaultWriter';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GateCriterion {
    id: string;
    description: string;
    /**
     * Enterprise domain this criterion belongs to (e.g. 'legal', 'rrhh').
     * Used by GateReflectionBridge to file incidents in the correct domain catalog.
     */
    domain?: string;
    /**
     * Explicit failureType from ENTERPRISE_DOMAINS.
     * When set, incidents are filed deterministically without keyword matching.
     */
    failureType?: string;
    passed?: boolean;
    evidence?: string;
    evaluatedBy?: string;
    evaluatedAt?: string;
}

export type GateLogEvent =
    | 'criterion_evaluated'
    | 'criterion_rejected'
    | 'self_evaluation_attempt'
    | 'missing_evidence_attempt'
    | 'gate_rejected';

export interface GateLogEntry {
    at: string;
    event: GateLogEvent;
    criterionId?: string;
    evaluatorId?: string;
    detail?: string;
}

export interface GateRecord {
    stepId: string;
    flowId: string;
    runId: string;
    executor: string;
    criteria: GateCriterion[];
    verdict: 'passed' | 'failed' | 'pending';
    log: GateLogEntry[];
}

export interface ComplianceGateOptions {
    stepId: string;
    flowId: string;
    runId: string;
    /** Agent that executed the step — cannot also be the evaluator. */
    executor: string;
    /** Criterion descriptions from the YAML gate.criteria array. */
    criteria: string[];
    evidenceMode: 'required' | 'optional';
    /**
     * Where every event of the gate is also written, one audit event each. Give it a `HashChainAuditSink` and the record of the gate is
     * a chain a third party can verify; the note in the vault (`persist`) is a readable copy that anyone with access to the vault can
     * edit. A sink that throws makes the evaluation fail: a decision that cannot be recorded is not taken.
     */
    audit?: AuditSink;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/**
 * A flow id or run id as one directory name. Both come from outside (a flow definition, the caller of the runner),
 * and the audit trail must land under `auditoria/` whatever they say: separators and drive colons become `_`,
 * and `.` / `..` / empty become `_`.
 */
function dirSegment(id: string): string {
    const segment = id.replace(/[\\/:\u0000]/g, '_').trim();
    return segment === '' || segment === '.' || segment === '..' ? '_' : segment;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class ComplianceGateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ComplianceGateError';
    }
}

// ── ComplianceGate ────────────────────────────────────────────────────────────

export class ComplianceGate {
    private readonly _record: GateRecord;
    /** Set by `reject()` and never cleared: a rejected gate stays rejected whatever is evaluated after (ADR-0010). */
    private rejected = false;
    private readonly evidenceMode: 'required' | 'optional';
    private readonly audit?: AuditSink;
    private readonly auditWrites: Array<Promise<void>> = [];

    constructor(opts: ComplianceGateOptions) {
        this.evidenceMode = opts.evidenceMode;
        this.audit = opts.audit;
        this._record = {
            stepId: opts.stepId,
            flowId: opts.flowId,
            runId: opts.runId,
            executor: opts.executor,
            criteria: opts.criteria.map((desc, i) => ({
                id: `c${i}`,
                description: desc,
            })),
            verdict: 'pending',
            log: [],
        };
    }

    /**
     * Evaluates a single criterion by index.
     *
     * Throws `ComplianceGateError` when:
     * - `evaluatorId` equals the executor (self-evaluation)
     * - `passed` is true but evidence is missing and `evidenceMode` is 'required'
     *
     * A failed attempt is ALWAYS appended to the log before throwing,
     * so there is no path to bypass the gate silently.
     */
    evaluateCriterion(
        index: number,
        evaluatorId: string,
        passed: boolean,
        evidence?: string,
    ): void {
        if (evaluatorId === this._record.executor) {
            this.appendLog({
                event: 'self_evaluation_attempt',
                criterionId: `c${index}`,
                evaluatorId,
                detail: `executor "${this._record.executor}" cannot evaluate their own step`,
            });
            throw new ComplianceGateError(
                `evaluator "${evaluatorId}" is the same as the executor — self-evaluation is not allowed`,
            );
        }

        if (passed && this.evidenceMode === 'required' && !evidence?.trim()) {
            this.appendLog({
                event: 'missing_evidence_attempt',
                criterionId: `c${index}`,
                evaluatorId,
                detail: 'evidence required but not provided',
            });
            throw new ComplianceGateError(
                `criterion c${index} requires evidence but none was provided`,
            );
        }

        const criterion = this._record.criteria[index];
        if (!criterion) {
            throw new ComplianceGateError(`criterion index ${index} out of range`);
        }

        criterion.passed = passed;
        criterion.evidence = evidence;
        criterion.evaluatedBy = evaluatorId;
        criterion.evaluatedAt = new Date().toISOString();

        this.appendLog({
            event: passed ? 'criterion_evaluated' : 'criterion_rejected',
            criterionId: criterion.id,
            evaluatorId,
            detail: passed ? (evidence ?? undefined) : 'criterion marked as failed',
        });

        this._record.verdict = this.computeVerdict();
    }

    /**
     * Rejects the entire gate immediately (e.g. evaluator found a blocking issue
     * before checking individual criteria). Evaluator ≠ executor is still enforced.
     */
    reject(evaluatorId: string, reason?: string): void {
        if (evaluatorId === this._record.executor) {
            this.appendLog({
                event: 'self_evaluation_attempt',
                evaluatorId,
                detail: 'attempted self-rejection',
            });
            throw new ComplianceGateError(
                `evaluator "${evaluatorId}" cannot reject their own step`,
            );
        }
        this.rejected = true;
        this._record.verdict = 'failed';
        this.appendLog({
            event: 'gate_rejected',
            evaluatorId,
            detail: reason,
        });
    }

    /** Returns an immutable snapshot of the current gate state. */
    getRecord(): GateRecord {
        return {
            ...this._record,
            criteria: this._record.criteria.map(c => ({ ...c })),
            log: this._record.log.map(e => ({ ...e })),
        };
    }

    get verdict(): 'passed' | 'failed' | 'pending' {
        return this._record.verdict;
    }

    /**
     * Persists the gate record to the vault under
     * `/auditoria/{flowId}/{runId}/gate-{stepId}.md`.
     * Returns the absolute file path written.
     */
    async persist(vaultPath: string): Promise<string> {
        await Promise.all(this.auditWrites);          // an audit write that failed asynchronously fails the persist, not silently
        const record = this.getRecord();

        const rows = record.criteria.map(c =>
            `| ${c.id} | ${c.description} | ${c.passed ?? '—'} | ${c.evaluatedBy ?? '—'} | ${c.evidence ?? '—'} |`,
        );

        const logRows = record.log.map(e =>
            `| ${e.at} | ${e.event} | ${e.criterionId ?? '—'} | ${e.evaluatorId ?? '—'} | ${e.detail ?? '—'} |`,
        );

        const content = [
            `## Gate — ${record.stepId}`,
            '',
            '| Field | Value |',
            '|-------|-------|',
            `| Flow | \`${record.flowId}\` |`,
            `| Step | \`${record.stepId}\` |`,
            `| Run | \`${record.runId}\` |`,
            `| Executor | \`${record.executor}\` |`,
            `| Verdict | **${record.verdict}** |`,
            '',
            '### Criteria',
            '',
            '| ID | Description | Passed | Evaluator | Evidence |',
            '|----|-------------|--------|-----------|----------|',
            ...rows,
            '',
            '### Audit Log',
            '',
            '| At | Event | Criterion | Evaluator | Detail |',
            '|----|-------|-----------|-----------|--------|',
            ...logRows,
        ].join('\n');

        const writer = new VaultWriter({
            vaultPath,
            agentFolder: path.join('auditoria', dirSegment(record.flowId), dirSegment(record.runId)),
        });

        return writer.writeNote({
            title: `Gate: ${record.flowId}/${record.stepId} (${record.runId})`,
            content,
            agentId: 'compliance-gate',
            tags: [
                'auditoria',
                `flow/${record.flowId}`,
                `step/${record.stepId}`,
                `verdict/${record.verdict}`,
            ],
            description: `Compliance gate — verdict: ${record.verdict}`,
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private computeVerdict(): 'passed' | 'failed' | 'pending' {
        if (this.rejected) return 'failed';
        const criteria = this._record.criteria;
        if (criteria.some(c => c.passed === false)) return 'failed';
        if (criteria.every(c => c.passed === true)) return 'passed';
        return 'pending';
    }

    private appendLog(entry: Omit<GateLogEntry, 'at'>): void {
        const full: GateLogEntry = { at: new Date().toISOString(), ...entry };
        this._record.log.push(full);
        if (!this.audit) return;
        const r = this._record;
        const event: AuditEvent = {
            at: full.at,
            principal: { agentId: full.evaluatorId ?? r.executor, sessionId: r.runId, chain: [r.executor] },
            tool: `compliance_gate.${full.event}`,
            argsHash: hashArgs({ flowId: r.flowId, runId: r.runId, stepId: r.stepId, criterionId: full.criterionId ?? null, detail: full.detail ?? null }),
            decision: full.event === 'criterion_evaluated' ? 'allow' : 'deny',
            ...(full.detail ? { reason: full.detail } : {}),
            durationMs: 0,
            meta: { flowId: r.flowId, stepId: r.stepId, executor: r.executor, ...(full.criterionId ? { criterionId: full.criterionId } : {}) },
        };
        const written = this.audit.write(event);          // a sink that throws (the hash chain does) throws here, before the decision is taken
        if (written && typeof (written as Promise<void>).then === 'function') {
            const p = (written as Promise<void>).then(() => undefined);
            p.catch(() => undefined);                       // reported by persist(); not an unhandled rejection meanwhile
            this.auditWrites.push(p);
        }
    }
}
