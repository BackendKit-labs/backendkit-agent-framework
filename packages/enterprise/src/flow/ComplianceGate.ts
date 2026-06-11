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
import { VaultWriter } from '../rag/VaultWriter';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GateCriterion {
    id: string;
    description: string;
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
    private readonly evidenceMode: 'required' | 'optional';

    constructor(opts: ComplianceGateOptions) {
        this.evidenceMode = opts.evidenceMode;
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
            agentFolder: path.join('auditoria', record.flowId, record.runId),
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
        const criteria = this._record.criteria;
        if (criteria.some(c => c.passed === false)) return 'failed';
        if (criteria.every(c => c.passed === true)) return 'passed';
        return 'pending';
    }

    private appendLog(entry: Omit<GateLogEntry, 'at'>): void {
        this._record.log.push({ at: new Date().toISOString(), ...entry });
    }
}
