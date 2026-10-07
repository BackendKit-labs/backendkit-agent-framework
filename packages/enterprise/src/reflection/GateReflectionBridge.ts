import type { ReflectionEngine } from '@backendkit-labs/agent-core';
import type { FailureRecord } from '@backendkit-labs/agent-core/reflection';
import type { GateRecord } from '../flow/ComplianceGate.js';
import { ENTERPRISE_DOMAINS, SEVERITY_THRESHOLD } from './domains.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function evaluatorOf(record: GateRecord): string {
    // Evaluator is stored on the log entries that have one — first non-executor found
    for (const entry of record.log) {
        if (entry.evaluatorId && entry.evaluatorId !== record.executor) {
            return entry.evaluatorId;
        }
    }
    return 'unknown-evaluator';
}

function resolveSeverity(domain: string | undefined, failureType: string | undefined): FailureRecord['severity'] {
    if (!domain || !failureType) return 'medium';
    const domainDef = ENTERPRISE_DOMAINS.find(d => d.name === domain);
    if (!domainDef) return 'medium';
    const ftDef = domainDef.failureTypes.find(f => f.name === failureType);
    return (ftDef?.severity ?? 'medium') as FailureRecord['severity'];
}

function thresholdFor(domain: string | undefined, failureType: string | undefined): number {
    const severity = resolveSeverity(domain, failureType);
    return SEVERITY_THRESHOLD[severity] ?? 3;
}

// ── GateReflectionBridge ──────────────────────────────────────────────────────

export interface GateBridgeResult {
    incidents:  FailureRecord[];
    threshold:  number;   // lowest threshold across filed incidents (caller uses for detect)
}

/**
 * Translates a resolved GateRecord into FailureRecord incidents in the
 * ReflectionEngine catalog.
 *
 * Provenance safety: every incident is attributed to the gate's EVALUATOR,
 * not the executor. Since ComplianceGate already enforces evaluator≠executor,
 * an agent cannot self-report incidents to poison the catalog.
 *
 * Self-evaluation and missing-evidence attempts are filed as gate_integrity
 * violations in the 'agent' domain — they signal process failure, not just
 * business failure.
 */
export async function recordGateOutcome(
    record: GateRecord,
    engine:  ReflectionEngine,
): Promise<GateBridgeResult> {
    const incidents: FailureRecord[] = [];
    let lowestThreshold = 3;
    const evaluator = evaluatorOf(record);

    // ── Business failures: criteria marked as failed ──────────────────────────
    for (const c of record.criteria) {
        if (c.passed !== false) continue;

        const domain      = (c as any).domain      as string | undefined;
        const failureType = (c as any).failureType as string | undefined;
        const severity    = resolveSeverity(domain, failureType);
        const threshold   = thresholdFor(domain, failureType);
        if (threshold < lowestThreshold) lowestThreshold = threshold;

        const { record: r } = await engine.reportIncident({
            domain:            domain      ?? 'agent',
            failureType:       failureType ?? detectFallback(c.description, domain),
            severity,
            dimension:         'compliance',
            gate:              record.stepId,
            agenteResponsable: record.executor,
            hallazgo:          c.description,
            recomendacion:     recommendationFor(domain, failureType),
            archivos:          [],
            fecha:             new Date().toISOString(),
            contextRaw:        JSON.stringify({
                reportedBy:  evaluator,
                criterionId: c.id,
                flowId:      record.flowId,
                runId:       record.runId,
            }),
        });
        incidents.push(r);
    }

    // ── Process failures: integrity violations in the audit log ───────────────
    for (const entry of record.log) {
        if (
            entry.event !== 'self_evaluation_attempt' &&
            entry.event !== 'missing_evidence_attempt'
        ) continue;

        const { record: r } = await engine.reportIncident({
            domain:            'agent',
            failureType:       'gate_integrity_violation',
            severity:          'high',
            dimension:         'proceso',
            gate:              record.stepId,
            agenteResponsable: entry.evaluatorId ?? record.executor,
            hallazgo:          entry.detail ?? `Gate integrity violation: ${entry.event}`,
            recomendacion:     'Revisar configuración de evaluador — nunca puede coincidir con el ejecutor',
            archivos:          [],
            fecha:             entry.at,
            contextRaw:        JSON.stringify({
                event:   entry.event,
                flowId:  record.flowId,
                runId:   record.runId,
            }),
        });
        incidents.push(r);
    }

    return { incidents, threshold: lowestThreshold };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function detectFallback(hallazgo: string, domain: string | undefined): string {
    if (!domain) return 'unknown_failure';
    const domainDef = ENTERPRISE_DOMAINS.find(d => d.name === domain);
    if (!domainDef) return 'unknown_failure';
    const lower = hallazgo.toLowerCase();
    for (const ft of domainDef.failureTypes) {
        if (ft.keywords.some(kw => lower.includes(kw))) return ft.name;
    }
    return 'unknown_failure';
}

function recommendationFor(domain: string | undefined, failureType: string | undefined): string {
    if (!domain || !failureType) return '';
    const domainDef = ENTERPRISE_DOMAINS.find(d => d.name === domain);
    return domainDef?.failureTypes.find(f => f.name === failureType)?.recommendation ?? '';
}
