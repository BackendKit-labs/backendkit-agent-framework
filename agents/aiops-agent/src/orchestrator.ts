import type { ToolDefinition } from '@backendkit-labs/agent-core';
import type { ClassifierAgent, DeciderAgent } from './agents';
import { AuditLog, sanitize } from './audit';
import { getPolicies, type Db } from './db';
import { categoryHint, evaluatePolicies, guardDecision, severityFloor, WRITE_ACTIONS } from './policy';
import { ACTION_TOOL, runTool } from './tools';
import {
    severityRank,
    type Action, type Alert, type AuditEvent, type Classification, type Decision, type ServerStatus,
    type Severity, type SimilarResult,
} from './types';

export interface OrchestratorDeps {
    db: Db;
    tools: Record<string, ToolDefinition>;
    classifier: ClassifierAgent;
    decider: DeciderAgent;
    logPath: string;
    maxAlertChars?: number;
}

export interface RunResult {
    alertId: string;
    finalAction: Action;
    requiresApproval: boolean;
    classification: Classification | null;
    server: ServerStatus | null;
    similar: SimilarResult | null;
    decision: Decision | null;
    toolName: string | null;
    toolResult: Record<string, unknown> | null;
    evidence: string[];
    justification: string[];
    policyIds: string[];
    riskLevel: 'low' | 'medium' | 'high';
    confidence: number;
    events: AuditEvent[];
}

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;
const riskOf = (s: Severity): 'low' | 'medium' | 'high' => (s === 'low' ? 'low' : s === 'medium' ? 'medium' : 'high');
const SERVER_RE =/\b(?:prod|stg|dev)-\d+\b/i;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Linear, fully audited pipeline. The LLM only proposes; code validates, guards and executes. */
export class Orchestrator {
    constructor(private readonly deps: OrchestratorDeps) {}

    async run(alert: Alert): Promise<RunResult> {
        const { db, tools, classifier, decider } = this.deps;
        const log = new AuditLog(this.deps.logPath, alert.id);
        const text = sanitize(alert.text, this.deps.maxAlertChars ?? 2000);
        const result: RunResult = {
            alertId: alert.id, finalAction: 'needs_human', requiresApproval: true, classification: null,
            server: null, similar: null, decision: null, toolName: null, toolResult: null,
            evidence: [], justification: [], policyIds: [], riskLevel: 'high', confidence: 0, events: log.events,
        };
        const finish = (reason: string): RunResult => {
            result.finalAction = 'needs_human';
            result.requiresApproval = true;
            log.record('final', 'orchestrator', {
                analysis_summary: reason, evidence: result.evidence, requires_approval: true,
                risk_level: result.riskLevel, final_decision: 'needs_human',
            });
            return result;
        };

        log.record('received', 'orchestrator', {
            input_summary: `[${alert.source}] ${text}`,
            analysis_summary: 'alerta recibida; el texto se trata como dato no confiable',
        });

        // 1. classify (LLM)
        let cls: Classification;
        try {
            cls = await classifier.classify(text);
        } catch (e) {
            log.record('classify', classifier.name, { input_summary: text, analysis_summary: `fallo: ${errMsg(e)}` });
            return finish(`clasificación fallida: ${errMsg(e)}`);
        }
        let hintNote = '';
        const hint = categoryHint(text);
        if (hint && hint !== cls.category) {
            hintNote = `; categoría corregida de ${cls.category} a ${hint} por palabra clave del texto`;
            cls = { ...cls, category: hint };
        }
        result.classification = cls;
        result.riskLevel = riskOf(cls.severity);
        log.record('classify', classifier.name, {
            input_summary: text,
            analysis_summary: `severidad=${cls.severity}, categoría=${cls.category}: ${cls.summary}${hintNote}`,
            confidence: cls.confidence, risk_level: result.riskLevel,
        });

        // 2. server status (deterministic extraction beats model output)
        const serverName = alert.server ?? text.match(SERVER_RE)?.[0]?.toLowerCase() ?? cls.server ?? 'desconocido';
        const server = (await runTool(tools, 'get_server_status', { server: serverName })) as unknown as ServerStatus;
        result.server = server;
        const evidence: string[] = [`server:${serverName}`];
        let raisedNote = '';
        const floor = severityFloor(server);
        if (floor && severityRank(floor) > severityRank(cls.severity)) {
            raisedNote = `; severidad elevada de ${cls.severity} a ${floor} por estado real del inventario`;
            cls = { ...cls, severity: floor };
            result.classification = cls;
            result.riskLevel = riskOf(floor);
        }
        log.record('server_status', 'orchestrator', {
            input_summary: `get_server_status(${serverName})`,
            analysis_summary: (server.found
                ? `${server.name}: env=${server.env}, criticidad=${server.criticality}, cpu=${server.cpu_pct}%, status=${server.status}`
                : `servidor ${serverName} no encontrado en el inventario`) + raisedNote,
            evidence, selected_tool: 'get_server_status', tool_args: { server: serverName },
            tool_result: server as unknown as Record<string, unknown>, risk_level: result.riskLevel,
        });

        // 3. policies
        const pctx = evaluatePolicies(getPolicies(db), server, cls);
        result.policyIds = pctx.matched.map(p => p.id);
        evidence.push(...result.policyIds.map(id => `policy:${id}`));
        log.record('policy_check', 'orchestrator', {
            analysis_summary: pctx.matched.length
                ? `políticas aplicables: ${result.policyIds.join(', ')}`
                : 'sin políticas aplicables; solo acciones seguras',
            evidence: [...evidence],
            policy_check: {
                policy_ids: result.policyIds, allowed_actions: pctx.allowed,
                max_severity_autonomous: pctx.maxSeverityAutonomous, passed: true, notes: [],
            },
        });

        // 4. similar incidents
        const sim = (await runTool(tools, 'search_similar_incidents', { query: `${cls.summary} ${text}`, k: 3 })) as unknown as SimilarResult;
        result.similar = sim;
        evidence.push(...(sim.matches ?? []).map(m => `incident:${m.id}`));
        log.record('similar_incidents', 'orchestrator', {
            input_summary: 'search_similar_incidents',
            analysis_summary: `${sim.matches?.length ?? 0} coincidencias (método=${sim.method}, embed=${sim.embed_ms} ms, búsqueda=${sim.search_ms} ms)`,
            evidence: [...evidence], selected_tool: 'search_similar_incidents',
            tool_result: sim as unknown as Record<string, unknown>,
        });

        // 5. decide (LLM)
        let decision: Decision;
        try {
            decision = await decider.decide({
                alertText: text, classification: cls, server,
                policies: pctx.matched.map(p => ({ id: p.id, description: p.description })),
                allowedActions: pctx.allowed, similar: sim,
            });
        } catch (e) {
            log.record('decide', decider.name, { analysis_summary: `fallo: ${errMsg(e)}`, evidence: [...evidence] });
            result.evidence = evidence;
            return finish(`decisión fallida: ${errMsg(e)}`);
        }
        const known = new Set(evidence);
        const droppedRefs = decision.evidenceRefs.filter(r => !known.has(r));
        decision = { ...decision, evidenceRefs: decision.evidenceRefs.filter(r => known.has(r)) };
        result.decision = decision;
        log.record('decide', decider.name, {
            analysis_summary: `acción propuesta=${decision.action}`
                + (droppedRefs.length ? `; referencias descartadas por no existir: ${droppedRefs.join(', ')}` : ''),
            evidence: decision.evidenceRefs, justification: decision.justification,
            confidence: decision.confidence, risk_level: decision.riskLevel,
            selected_tool: ACTION_TOOL[decision.action], tool_args: decision.toolArgs,
        });

        // 6. deterministic policy guard
        const guard = guardDecision(decision, pctx, server, cls);
        result.requiresApproval = guard.requiresApproval;
        log.record('policy_guard', 'policy-guard', {
            analysis_summary: guard.action === decision.action
                ? `acción ${guard.action} conforme a política`
                : `acción ${decision.action} degradada a ${guard.action}`,
            evidence: [...evidence], policy_check: guard.check,
            requires_approval: guard.requiresApproval, risk_level: decision.riskLevel,
        });

        // 7. execute MOCK tool (dry-run when approval is required)
        let finalAction = guard.action;
        const toolName = ACTION_TOOL[finalAction];
        let toolResult: Record<string, unknown> | null = null;
        let toolArgs: Record<string, unknown> | null = null;
        if (toolName) {
            toolArgs = this.buildToolArgs(finalAction, alert, cls, server, decision, guard.requiresApproval);
            if (toolArgs === null) {
                toolResult = { status: 'needs_human', reason: 'faltan datos para ejecutar la acción' };
            } else {
                toolResult = await runTool(tools, toolName, toolArgs);
            }
            if (toolResult['status'] === 'needs_human') finalAction = 'needs_human';
        }
        result.toolName = toolName;
        result.toolResult = toolResult;
        const requiresApproval = guard.requiresApproval || finalAction === 'needs_human';
        result.requiresApproval = requiresApproval;
        log.record('tool_exec', 'orchestrator', {
            analysis_summary: toolName
                ? `ejecución simulada de ${toolName}${guard.requiresApproval ? ' (pendiente de aprobación, dry-run)' : ''}`
                : `acción ${finalAction} no ejecuta herramienta`,
            selected_tool: toolName, tool_args: toolArgs, tool_result: toolResult,
            requires_approval: requiresApproval, evidence: [...evidence],
        });

        // 8. final
        result.finalAction = finalAction;
        result.evidence = [...new Set([...evidence, ...decision.evidenceRefs])];
        result.justification = decision.justification;
        result.riskLevel = RISK_RANK[decision.riskLevel] >= RISK_RANK[result.riskLevel] ? decision.riskLevel : result.riskLevel;
        result.confidence = decision.confidence;
        log.record('final', 'orchestrator', {
            analysis_summary: `decisión final: ${finalAction}${requiresApproval ? ' (requiere aprobación humana)' : ''}`,
            evidence: result.evidence, policy_check: guard.check, selected_tool: toolName,
            tool_args: toolArgs, justification: decision.justification, confidence: decision.confidence,
            risk_level: decision.riskLevel, requires_approval: requiresApproval,
            tool_result: toolResult, final_decision: finalAction,
        });
        return result;
    }

    /** Deterministic args: server comes from inventory, never from the model. */
    private buildToolArgs(
        action: Action, alert: Alert, cls: Classification, server: ServerStatus,
        decision: Decision, dryRun: boolean,
    ): Record<string, unknown> | null {
        const a = decision.toolArgs;
        const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
        switch (action) {
            case 'scale_cpu':
                return { server: server.name, delta_vcpu: typeof a['delta_vcpu'] === 'number' ? a['delta_vcpu'] : 2, dry_run: dryRun };
            case 'restart_service': {
                const wanted = str(a['service']);
                const service = wanted && server.services?.includes(wanted) ? wanted : server.services?.[0];
                return service ? { server: server.name, service, dry_run: dryRun } : null;
            }
            case 'open_ticket':
                return { mode: 'open', alert_id: alert.id, title: cls.summary.slice(0, 200), body: str(a['body']) ?? cls.summary };
            case 'update_ticket':
                return { mode: 'update', alert_id: alert.id, ticket_id: str(a['ticket_id']), body: str(a['body']) ?? cls.summary };
            case 'escalate':
                return { reason: str(a['reason']) ?? decision.justification[0] ?? cls.summary, severity: cls.severity };
            default:
                return WRITE_ACTIONS.includes(action) ? null : {};
        }
    }
}
