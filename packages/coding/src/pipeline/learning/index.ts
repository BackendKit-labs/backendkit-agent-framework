/**
 * Coding as a plugin of the learning module of agent-core (SPEC-0017 F6): the findings of the audit gates become
 * experiences, and a pattern of them proposes a `PolicyRule` for the orchestrator. The rule waits for a person: it
 * is never applied on its own.
 */
import { join } from 'node:path';
import {
    createLearning, getProjectDir,
    type ApprovedRule, type AuditFinding, type LearnedPattern, type Learning, type RuleStore,
} from '@backendkit-labs/agent-core';
import type { PolicyRule } from '../orchestration/types';
import { detectAuditFailureType, getAuditFailureTypeMeta } from '../reflection/domains/audit-domain';

/** Keywords of a task that the rule of each failure type matches. */
const KEYWORDS: Record<string, string[]> = {
    missing_rollback: ['transaccion', 'transaction', 'rollback', 'database', 'base de datos'],
    connection_leak: ['conexion', 'connection', 'pool', 'socket', 'database'],
    security_vulnerability: ['seguridad', 'auth', 'jwt', 'oauth', 'vulnerabilidad', 'security'],
    missing_test_coverage: ['cobertura', 'coverage', 'test', 'prueba'],
    incomplete_error_handling: ['error', 'exception', 'catch', 'manejo de errores'],
    missing_documentation: ['documentacion', 'documentation', 'doc', 'readme'],
    architecture_violation: ['arquitectura', 'architecture', 'capa', 'modulo', 'dependencia'],
    missing_logging: ['log', 'logging', 'registro', 'logger'],
    unvalidated_input: ['input', 'validacion', 'validation', 'request', 'form'],
    hardcoded_secret: ['password', 'secret', 'api_key', 'token', 'credential'],
    tsc_noEmit_type_error: ['typescript', 'type', 'tsc', 'compile'],
    jest_timeout: ['timeout', 'jest', 'async', 'await'],
    coverage_below_threshold: ['cobertura', 'coverage', 'threshold', 'umbral'],
    flaky_test: ['flaky', 'intermittent', 'inestable'],
    missing_test_for_use_case: ['caso de uso', 'use case', 'escenario', 'scenario'],
    test_without_assertion: ['assertion', 'expect', 'assert'],
    integration_test_without_container: ['integration', 'container', 'docker', 'integracion'],
    property_test_missing: ['property', 'generative', 'fuzzing'],
    unknown_failure: ['commit', 'mensaje', 'message'],
    missing_type: ['conventional', 'feat', 'fix', 'chore', 'tipo de commit'],
    wrong_scope: ['scope', 'alcance', 'modulo'],
    message_too_long: ['commit', 'largo', 'mensaje largo'],
    missing_issue_reference: ['issue', 'ticket', 'jira', 'referencia'],
    coverage_not_run: ['cobertura', 'coverage', 'jest'],
    typecheck_failed_before_commit: ['typescript', 'typecheck', 'tsc', 'compile'],
    test_failed_before_commit: ['test', 'jest', 'prueba fallida'],
    branch_naming_invalid: ['branch', 'rama', 'naming', 'feature', 'hotfix'],
};

/** A rule of the orchestrator, with the name a person reads when approving it. */
export interface CodingPolicyProposal extends PolicyRule {
    name: string;
    trigger: { domain: string; pattern: string; minOccurrences: number };
}

/**
 * The orchestrator rule a pattern of the coding domains proposes (audit, test, commit). A tool failure or any other
 * pattern proposes none: it stays a lesson.
 */
export function policyRuleFor(pattern: LearnedPattern): CodingPolicyProposal | undefined {
    if (pattern.domain !== 'audit' && pattern.domain !== 'test' && pattern.domain !== 'commit') return undefined;

    const condition: Record<string, unknown> = {};
    const keywords = KEYWORDS[pattern.kind];
    if (keywords?.length) condition.keywords = keywords;
    if (pattern.domain === 'audit' && pattern.kind.includes('security')) condition.domain = 'security';
    if (pattern.domain === 'test') condition.actionType = 'test';
    if (pattern.domain === 'commit') condition.actionType = ['implementation', 'refactor', 'bugfix'];
    if (pattern.severity === 'critical' || pattern.severity === 'high') condition.riskLevel = ['high', 'critical'];
    else if (pattern.severity === 'medium') condition.riskLevel = 'medium';

    const action: Record<string, unknown> = {};
    if (pattern.domain === 'audit') {
        action.requireQaApproval = true;
        if (pattern.kind.includes('security')) action.requireSecurityReview = true;
    } else if (pattern.domain === 'test') {
        action.mustInclude = ['qa-engineer'];
        if (pattern.kind.includes('coverage')) action.mustExecute = ['test-coverage-check'];
    } else {
        action.mustInclude = ['qa-engineer'];
        action.requireQaApproval = true;
    }

    const readable = pattern.kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
        name: `[${pattern.domain.charAt(0).toUpperCase()}${pattern.domain.slice(1)}] ${readable}`,
        if: condition,
        then: action,
        trigger: { domain: pattern.domain, pattern: pattern.kind, minOccurrences: pattern.count },
    } as CodingPolicyProposal;
}

export interface CodingLearningOptions {
    appName: string;
    projectRoot?: string;
    /** Repetitions that make a pattern. Default 3. */
    threshold?: number;
}

/**
 * The learning of a coding project, kept in `~/.{appName}/projects/<key>/learning/`: the experiences, the proposed
 * rules (one file set per proposal), the approved ones and the lessons a person taught. Several processes may open the same directory, so a person
 * can approve from another terminal.
 */
export function createCodingLearning(options: CodingLearningOptions): Learning {
    const dir = join(getProjectDir(options.appName, options.projectRoot), 'learning');
    return createLearning({
        dir,
        ruleFor: policyRuleFor,
        ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
    });
}

/** Records the findings of an audit gate as experiences. */
export async function recordAuditFindings(learning: Learning, findings: AuditFinding[], gate: string): Promise<void> {
    for (const finding of findings) {
        const kind = detectAuditFailureType(finding.hallazgo);
        const meta = getAuditFailureTypeMeta(kind);
        await learning.record({
            at: finding.resolvedAt,
            agentId: finding.agenteResponsable,
            domain: 'audit',
            situation: finding.hallazgo,
            action: gate,
            kind,
            severity: finding.severidad,
            detail: finding.recomendacion ?? meta?.genericRecommendation,
            meta: { gate, dimension: finding.dimension, ...(finding.evidencia ? { evidence: finding.evidencia } : {}) },
        });
    }
}

/** The approved rules that are orchestrator rules (the others, e.g. tool rules, are not for the orchestrator). */
export async function approvedPolicyRules(rules: RuleStore): Promise<PolicyRule[]> {
    const approved: ApprovedRule[] = await rules.list();
    return approved
        .map(a => a.rule as Partial<PolicyRule> | null)
        .filter((r): r is PolicyRule => !!r && typeof r === 'object' && !!r.if && !!r.then)
        .map(r => ({ if: r.if, then: r.then }) as PolicyRule);
}
