import { z } from '@backendkit-labs/agent-core';

/** Closed action catalog. Anything else is rejected and coerced to needs_human. */
export const ActionEnum = z.enum([
    'restart_service',
    'scale_cpu',
    'open_ticket',
    'update_ticket',
    'escalate',
    'no_action',
    'needs_human',
]);
export type Action = z.infer<typeof ActionEnum>;

export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeverityEnum>;

export const CategoryEnum = z.enum(['cpu', 'memory', 'disk', 'network', 'service_down', 'other']);
export type Category = z.infer<typeof CategoryEnum>;

export const RiskEnum = z.enum(['low', 'medium', 'high']);
export type Risk = z.infer<typeof RiskEnum>;

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

export interface Alert {
    id: string;
    source: string;
    text: string;
    receivedAt: string;
    server?: string;
}

export const ClassificationSchema = z.object({
    severity: SeverityEnum,
    category: CategoryEnum,
    server: z.string().nullable().optional().transform(v => v ?? null),
    summary: z.string().max(400),
    confidence: z.number().min(0).max(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const DecisionSchema = z.object({
    action: ActionEnum,
    toolArgs: z.record(z.unknown()).default({}),
    justification: z.array(z.string().min(1)).min(3).max(5),
    evidenceRefs: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    riskLevel: RiskEnum,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const STEPS = [
    'received', 'classify', 'server_status', 'policy_check', 'similar_incidents',
    'knowledge_lookup', 'decide', 'policy_guard', 'tool_exec', 'final',
] as const;
export type Step = (typeof STEPS)[number];

export interface PolicyCheck {
    policy_ids: string[];
    allowed_actions: Action[];
    max_severity_autonomous: Severity | null;
    passed: boolean;
    notes: string[];
}

/** One JSONL line per step. Non-applicable fields are null, never omitted. */
export interface AuditEvent {
    timestamp: string;
    alert_id: string;
    step: Step;
    agent: string;
    input_summary: string | null;
    analysis_summary: string | null;
    evidence: string[];
    policy_check: PolicyCheck | null;
    selected_tool: string | null;
    tool_args: Record<string, unknown> | null;
    justification: string[] | null;
    confidence: number | null;
    risk_level: Risk | null;
    requires_approval: boolean | null;
    tool_result: Record<string, unknown> | null;
    final_decision: Action | null;
}

export const AUDIT_FIELDS: ReadonlyArray<keyof AuditEvent> = [
    'timestamp', 'alert_id', 'step', 'agent', 'input_summary', 'analysis_summary',
    'evidence', 'policy_check', 'selected_tool', 'tool_args', 'justification',
    'confidence', 'risk_level', 'requires_approval', 'tool_result', 'final_decision',
];

export interface ServerStatus {
    found: boolean;
    name: string;
    env?: 'prod' | 'stg' | 'dev';
    criticality?: 'low' | 'medium' | 'high';
    cpu_pct?: number;
    mem_pct?: number;
    status?: 'ok' | 'degraded' | 'down';
    services?: string[];
    autoscale?: boolean;
}

export interface SimilarMatch {
    id: string;
    title: string;
    score: number;
    resolution_action: Action;
    outcome: string;
}

export interface SimilarResult {
    method: 'embedding' | 'keyword';
    matches: SimilarMatch[];
    embed_ms: number;
    search_ms: number;
}
