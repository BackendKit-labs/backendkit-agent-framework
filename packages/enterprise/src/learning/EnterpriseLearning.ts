import * as path from 'node:path';
import {
    createLearning, FileApprovalStore, FileLessonStore, JsonFileStore,
} from '@backendkit-labs/agent-core';
import type {
    TaughtLesson, TeachInput, ApprovedRule, ApproverRef, Experience, LearnedPattern, Learning, MemoryStoreBackend, ApprovalStore, StoredApproval,
} from '@backendkit-labs/agent-core';
import type { GateRecord } from '../flow/ComplianceGate';
import { ENTERPRISE_DOMAINS, SEVERITY_THRESHOLD } from '../reflection/domains';
import { VaultRuleStore } from './VaultRuleStore';
import type { RuleOutcomes } from './VaultRuleStore';

export interface EnterpriseLearningOptions {
    /** Absolute path to the Obsidian vault. The approved rules live inside it, auditable with git. */
    vaultPath: string;
    /** Where the approved rules are written. Default: `{vaultPath}/politicas/_generated/manifest.yaml`. */
    manifestPath?: string;
    /** Where the experiences are kept. Default: a JSON file next to the manifest. */
    store?: MemoryStoreBackend;
    /** Where the proposals wait for a person. Default: a directory next to the manifest. */
    approvals?: ApprovalStore;
    /** The tenant this vault belongs to. What is learned here stays in it: lessons and rules never reach another tenant. */
    tenantId?: string;
}

type Severity = Experience['severity'];

function severityOf(domain: string | undefined, failureType: string | undefined): Severity {
    const ft = ENTERPRISE_DOMAINS.find(d => d.name === domain)?.failureTypes.find(f => f.name === failureType);
    return (ft?.severity ?? 'medium') as Severity;
}

function failureTypeFor(description: string, domain: string | undefined): string {
    const def = ENTERPRISE_DOMAINS.find(d => d.name === domain);
    if (!def) return 'unknown_failure';
    const lower = description.toLowerCase();
    return def.failureTypes.find(ft => ft.keywords.some(kw => lower.includes(kw)))?.name ?? 'unknown_failure';
}

function recommendationFor(domain: string | undefined, failureType: string | undefined): string {
    return ENTERPRISE_DOMAINS.find(d => d.name === domain)?.failureTypes.find(f => f.name === failureType)?.recommendation ?? '';
}

/** The rule a business pattern proposes: the keywords of its failure type, and QA approval when it is serious. */
function ruleFor(pattern: LearnedPattern) {
    const ft = ENTERPRISE_DOMAINS.find(d => d.name === pattern.domain)?.failureTypes.find(f => f.name === pattern.kind);
    if (!ft) return undefined;
    const condition: Record<string, unknown> = { keywords: ft.keywords };
    if (pattern.severity === 'critical' || pattern.severity === 'high') condition.riskLevel = ['high', 'critical'];
    else if (pattern.severity === 'medium') condition.riskLevel = 'medium';
    const readable = pattern.kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
        name: `[${pattern.domain.charAt(0).toUpperCase()}${pattern.domain.slice(1)}] ${readable}`,
        if: condition,
        then: ft.severity === 'high' || ft.severity === 'critical' ? { requireQaApproval: true } : {},
        trigger: { domain: pattern.domain, pattern: pattern.kind, minOccurrences: pattern.count },
    };
}

const asApprover = (who: string | ApproverRef): ApproverRef => typeof who === 'string' ? { kind: 'human', id: who } : who;

/**
 * Learning for the business agents of enterprise, on the learning module of agent-core (SPEC-0017 F6):
 *
 * - **Source of the experiences:** the `ComplianceGate`, where the evaluator is never the executor.
 * - **Threshold by severity:** critical 1, high 2, medium and low 3.
 * - **A person decides:** a pattern proposes a rule, and it applies only after `approvePromotion`.
 * - **The vault holds the rules** as YAML, so they are auditable and versionable with git.
 *
 * Replaces `EnterpriseReflection`, which stays but is deprecated.
 */
export class EnterpriseLearning {
    readonly learning: Learning;
    readonly rules: VaultRuleStore;
    private readonly tenantId?: string;

    constructor(opts: EnterpriseLearningOptions) {
        this.tenantId = opts.tenantId;
        const base = path.join(opts.vaultPath, 'politicas', '_generated');
        this.rules = new VaultRuleStore(opts.manifestPath ?? path.join(base, 'manifest.yaml'));
        this.learning = createLearning({
            store: opts.store ?? new JsonFileStore(path.join(base, 'experiences.json')),
            approvals: opts.approvals ?? new FileApprovalStore(path.join(base, 'proposals')),
            rules: this.rules,
            lessonStore: new FileLessonStore(path.join(base, 'taught-lessons.json')),
            thresholdFor: e => SEVERITY_THRESHOLD[e.severity] ?? 3,
            ruleFor,
        });
    }

    // ── MONITOR ───────────────────────────────────────────────────────────────

    /**
     * Records the outcome of a resolved ComplianceGate. Only failed criteria and process violations leave an
     * experience; a passed gate leaves none.
     */
    async recordGateOutcome(record: GateRecord): Promise<Experience[]> {
        const out: Experience[] = [];
        const evaluator = record.log.find(e => e.evaluatorId && e.evaluatorId !== record.executor)?.evaluatorId ?? 'unknown-evaluator';

        for (const c of record.criteria) {
            if (c.passed !== false) continue;
            const domain = (c as { domain?: string }).domain ?? 'agent';
            const kind = (c as { failureType?: string }).failureType ?? failureTypeFor(c.description, domain);
            out.push(await this.learning.record({
                agentId: record.executor,
                ...(this.tenantId ? { tenantId: this.tenantId } : {}),
                domain, kind,
                severity: severityOf(domain, kind),
                situation: c.description,
                action: record.stepId,
                detail: recommendationFor(domain, kind),
                meta: { dimension: 'compliance', reportedBy: evaluator, criterionId: c.id, flowId: record.flowId, runId: record.runId },
            }));
        }

        for (const entry of record.log) {
            if (entry.event !== 'self_evaluation_attempt' && entry.event !== 'missing_evidence_attempt') continue;
            out.push(await this.learning.record({
                at: entry.at,
                agentId: entry.evaluatorId ?? record.executor,
                ...(this.tenantId ? { tenantId: this.tenantId } : {}),
                domain: 'agent',
                kind: 'gate_integrity_violation',
                severity: 'high',
                situation: entry.detail ?? `Gate integrity violation: ${entry.event}`,
                action: record.stepId,
                detail: 'Revisar configuración de evaluador — nunca puede coincidir con el ejecutor',
                meta: { dimension: 'proceso', event: entry.event, flowId: record.flowId, runId: record.runId },
            }));
        }
        return out;
    }

    // ── ANALYZE ───────────────────────────────────────────────────────────────

    async patterns(): Promise<LearnedPattern[]> {
        return this.learning.patterns();
    }

    // ── PLAN / EXECUTE (a person decides) ─────────────────────────────────────

    /** Proposed rules waiting for a decision. */
    pendingPromotions(): Promise<StoredApproval[]> {
        return this.learning.proposals();
    }

    /** Approves a proposed rule; it starts to apply and is written to the vault. */
    approvePromotion(id: string, approver: string | ApproverRef, reason?: string): Promise<ApprovedRule> {
        return this.learning.approve(id, asApprover(approver), reason);
    }

    rejectPromotion(id: string, approver: string | ApproverRef, reason: string): Promise<void> {
        return this.learning.reject(id, asApprover(approver), reason);
    }

    // ── TEACH (a person says something specific) ─────────────────────────────

    /**
     * Teaches the agents of this vault something specific, without waiting for a failure to repeat: a lesson in their
     * prompt from now on. Stays inside the tenant of this `EnterpriseLearning`, if it has one.
     */
    teach(input: Omit<TeachInput, 'tenantId'>, by: string | ApproverRef): Promise<TaughtLesson> {
        return this.learning.teach({ ...input, ...(this.tenantId ? { tenantId: this.tenantId } : {}) }, asApprover(by));
    }

    taught(): Promise<TaughtLesson[]> {
        return this.learning.taught(this.tenantId ? { tenantId: this.tenantId } : {});
    }

    forget(lessonId: string): Promise<boolean> {
        return this.learning.forget(lessonId);
    }

    /** Adds a rule by hand, attributed to a person, and writes it to the vault with the others. */
    addRule(rule: unknown, by: string | ApproverRef, reason?: string): Promise<ApprovedRule> {
        return this.learning.addRule({ rule, ...(this.tenantId ? { tenantId: this.tenantId } : {}), ...(reason ? { reason } : {}) }, asApprover(by));
    }

    // ── KNOWLEDGE (consumed by the executor) ──────────────────────────────────

    async activeRules(filter?: { domain?: string }): Promise<ApprovedRule[]> {
        const all = await this.rules.list();
        if (!filter?.domain) return all;
        return all.filter(r => (r.rule as { trigger?: { domain?: string } }).trigger?.domain === filter.domain);
    }

    /** Counts a success or a failure where the rule was applied (a GO or a NO-GO of an evaluator). */
    async recordRuleOutcome(ruleId: string, outcome: 'success' | 'failure'): Promise<void> {
        await this.rules.recordOutcome(ruleId, outcome);
    }

    /** Rules that fail too often where they apply: candidates for a person to withdraw. */
    async demotionCandidates(opts: { minFailureRatio?: number; minTotal?: number } = {}): Promise<Array<ApprovedRule & { outcomes: RuleOutcomes }>> {
        const { minFailureRatio = 0.5, minTotal = 4 } = opts;
        const out: Array<ApprovedRule & { outcomes: RuleOutcomes }> = [];
        for (const rule of await this.rules.list()) {
            const outcomes = await this.rules.outcomes(rule.id);
            if (!outcomes) continue;
            const total = outcomes.success + outcomes.failure;
            if (total >= minTotal && outcomes.failure / total >= minFailureRatio) out.push({ ...rule, outcomes });
        }
        return out;
    }

    /** Withdraws a rule after a person agreed, leaving the reason as an experience so the history keeps it. */
    async approveDemotion(ruleId: string, approver: string | ApproverRef, reason: string): Promise<boolean> {
        const removed = await this.learning.retire(ruleId);
        if (removed) {
            await this.learning.record({
                agentId: asApprover(approver).id, ...(this.tenantId ? { tenantId: this.tenantId } : {}), domain: 'agent', kind: 'rule_demoted', outcome: 'success', severity: 'low',
                situation: `Rule ${ruleId} demoted`, action: 'reflection-demotion', detail: reason,
                meta: { ruleId },
            });
        }
        return removed;
    }
}
