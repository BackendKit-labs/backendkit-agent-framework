import type { PolicyRow } from './db';
import {
    severityRank,
    type Action, type Category, type Classification, type Decision, type PolicyCheck, type ServerStatus, type Severity,
} from './types';

/** Always allowed: safe fallbacks that never change infrastructure. */
const SAFE_ACTIONS: Action[] = ['needs_human', 'escalate'];
/** Actions that mutate infrastructure (even if simulated). */
export const WRITE_ACTIONS: Action[] = ['restart_service', 'scale_cpu'];

const matches = (csv: string, value: string): boolean =>
    csv === '*' || csv.split(',').map(s => s.trim()).includes(value);

const CATEGORY_HINTS: Array<[Exclude<Category, 'service_down' | 'other'>, RegExp]> = [
    ['cpu', /\bcpu\b|procesador/i],
    ['memory', /\bram\b|memoria|memory|\boom\b/i],
    ['disk', /\bdisco\b|disk|almacenamiento|filesystem/i],
    ['network', /\bred\b|network|latencia|packet|paquetes/i],
];

/** Resource keyword in the alert text, only when exactly one resource matches (else null). */
export function categoryHint(text: string): Category | null {
    const hits = CATEGORY_HINTS.filter(([, re]) => re.test(text)).map(([c]) => c);
    return hits.length === 1 ? hits[0]! : null;
}

/**
 * Minimum severity implied by hard inventory facts. Small models under-rate severity,
 * so code can only RAISE the model's classification, never lower it.
 */
export function severityFloor(server: ServerStatus): Severity | null {
    if (!server.found) return null;
    const load = Math.max(server.cpu_pct ?? 0, server.mem_pct ?? 0);
    let floor: Severity | null = null;
    if (load >= 95) floor = 'high';
    else if (load >= 85) floor = 'medium';
    if (server.status === 'down' || server.status === 'degraded') {
        floor = floor && severityRank(floor) > severityRank('medium') ? floor : 'medium';
    }
    if (server.env === 'prod' && server.criticality === 'high' && floor && severityRank(floor) >= severityRank('high')) {
        floor = 'critical';
    }
    return floor;
}

export interface PolicyContext {
    matched: PolicyRow[];
    allowed: Action[];
    maxSeverityAutonomous: Severity | null;
}

/** Select applicable policies; allowed = intersection (most restrictive wins). */
export function evaluatePolicies(
    policies: PolicyRow[], server: ServerStatus, classification: Classification,
): PolicyContext {
    if (!server.found || !server.env) return { matched: [], allowed: [...SAFE_ACTIONS], maxSeverityAutonomous: null };
    const matched = policies.filter(p =>
        matches(p.applies_env, server.env as string) && matches(p.applies_category, classification.category));
    if (matched.length === 0) return { matched, allowed: [...SAFE_ACTIONS], maxSeverityAutonomous: null };

    let allowed: Action[] = matched[0]!.allowed_actions;
    for (const p of matched.slice(1)) allowed = allowed.filter(a => p.allowed_actions.includes(a));
    let maxSev: Severity = matched[0]!.max_severity_autonomous;
    for (const p of matched) {
        if (severityRank(p.max_severity_autonomous) < severityRank(maxSev)) maxSev = p.max_severity_autonomous;
    }
    return { matched, allowed: [...new Set([...allowed, ...SAFE_ACTIONS])], maxSeverityAutonomous: maxSev };
}

export interface GuardResult {
    action: Action;
    requiresApproval: boolean;
    check: PolicyCheck;
}

/**
 * Deterministic guard (ADR-004). Runs after the LLM, ignores model confidence.
 * May downgrade the action to needs_human and decides requires_approval.
 */
export function guardDecision(
    decision: Decision, ctx: PolicyContext, server: ServerStatus, classification: Classification,
): GuardResult {
    const notes: string[] = [];
    let action: Action = decision.action;
    let passed = true;

    if (!server.found) {
        action = 'needs_human'; passed = false;
        notes.push('P-04: servidor desconocido en inventario');
    } else if (!ctx.allowed.includes(action)) {
        notes.push(`acción "${decision.action}" no permitida por ${ctx.matched.map(p => p.id).join(',') || 'políticas'}`);
        action = 'needs_human'; passed = false;
    } else if (action === 'scale_cpu' && (server.cpu_pct ?? 100) < 80) {
        notes.push(`P-06: scale_cpu exige cpu>=80% (actual ${server.cpu_pct}%)`);
        action = server.status === 'ok' ? 'no_action' : 'needs_human';
        passed = false;
    } else if (action === 'no_action' && (server.status !== 'ok' || (classification.category === 'cpu' && (server.cpu_pct ?? 100) >= 80))) {
        notes.push('P-05: no_action solo si status=ok y cpu<80');
        action = 'needs_human'; passed = false;
    }

    const aboveAutonomy = ctx.maxSeverityAutonomous === null
        || severityRank(classification.severity) > severityRank(ctx.maxSeverityAutonomous);
    const criticalServer = server.criticality === 'high' && WRITE_ACTIONS.includes(action);
    const requiresApproval = action === 'needs_human'
        || (WRITE_ACTIONS.includes(action) && (aboveAutonomy || criticalServer));
    if (requiresApproval && action !== 'needs_human') {
        notes.push(aboveAutonomy
            ? `severidad ${classification.severity} supera autonomía (${ctx.maxSeverityAutonomous ?? 'n/a'})`
            : 'servidor de criticidad alta');
    }

    return {
        action,
        requiresApproval,
        check: {
            policy_ids: ctx.matched.map(p => p.id),
            allowed_actions: ctx.allowed,
            max_severity_autonomous: ctx.maxSeverityAutonomous,
            passed,
            notes,
        },
    };
}
