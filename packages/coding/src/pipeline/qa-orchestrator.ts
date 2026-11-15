import type { Orchestrator } from './orchestration/orchestrator';
import type { OrchestrationResult } from './orchestration/types';
import type { TaskStatus } from './orchestration/task-context';
import type { QAService } from './qa/qa-service';
import type { AuditFinding } from './orchestration/audit';
import type { AuditFinding as ReflectionFinding } from '@backendkit-labs/agent-core';

function normalizeFindings(raw: ReflectionFinding[]): AuditFinding[] {
    return raw.map((f, i) => ({
        ...f,
        id: f.id ?? `finding-${i}`,
        evidencia: f.evidencia ?? '',
        recomendacion: f.recomendacion ?? '',
    }));
}

const MIN_CODE_LINES = 8;

const INFORMATIONAL_PATTERNS = [
    /\bexplain\b/i, /\bexplica(me)?\b/i, /\bdescribe\b/i, /\bqué hace\b/i,
    /\bcómo funciona\b/i, /\bwhat (is|does|are)\b/i, /\bhow does\b/i,
    /\bwhat('s| is) this\b/i,
];

function isInformationalRequest(rawPrompt?: string): boolean {
    if (!rawPrompt) return false;
    return INFORMATIONAL_PATTERNS.some(p => p.test(rawPrompt));
}

export interface QaContext {
    clean: string;
    orchestrationResult: OrchestrationResult;
    orchestrator: Orchestrator;
    qaService: QAService;
    /** Agent that wrote `clean`. */
    effectiveAgentId: string;
    /** Whether an agent with this id is registered. */
    hasAgent: (agentId: string) => boolean;
    /** Agent ID for the QA reviewer. Defaults to 'qa-engineer' when omitted. */
    qaAgentId?: string;
    /** Agent IDs for the auto-pass review gates. Default to agent-coding's roster ('security'/'architecture'). */
    reviewAgents?: { security?: string; architecture?: string };
    noQA?: boolean;
    onQAReview?: (review: string) => void;
}

/**
 * Avanza unicamente los gates que la tarea REQUIERE (segun sus flags
 * requiresArchitectureReview / requiresSecurityReview / requiresQaApproval).
 * Solo actua si la respuesta tiene codigo sustancial (>= 8 lineas).
 *
 * Un gate no requerido no se transiciona ni se registra: hacerlo contaminaba el
 * audit trail con GO de gates que nunca aplicaban (H-003).
 *
 * Distincion clave por tipo de gate:
 * - architecture / security: no tienen reviewer dedicado en este flujo, asi que
 *   un gate requerido se auto-pasa con GO silencioso.
 * - qa: SIEMPRE lo decide un reviewer real (qa-engineer dedicado o review inline).
 *   Aqui solo posicionamos la tarea en qa_review; el veredicto lo registra ese
 *   reviewer. Si el reviewer no existe, la tarea queda en qa_review SIN un GO
 *   falso "sin revisiones pendientes", e isCommitAllowed la mantiene bloqueada.
 */
export async function advanceRequiredGates(ctx: QaContext): Promise<void> {
    const { orchestrationResult, orchestrator, qaService, clean } = ctx;
    if (qaService.countCodeLines(clean) < MIN_CODE_LINES) return;
    if (isInformationalRequest(orchestrationResult.task.rawPrompt)) return;

    const { task } = orchestrationResult;
    const architectureAgentId = ctx.reviewAgents?.architecture ?? 'architecture';
    const securityAgentId     = ctx.reviewAgents?.security ?? 'security';

    // Gates auto-pasables: requeridos pero sin reviewer dedicado → GO silencioso.
    const autoPassGates: Array<{ status: TaskStatus; gateName: string; agentId: string; required: boolean }> = [
        { status: 'design_review',   gateName: 'architecture', agentId: architectureAgentId, required: task.requiresArchitectureReview },
        { status: 'security_review', gateName: 'security',     agentId: securityAgentId,     required: task.requiresSecurityReview },
    ];

    const reporter = orchestrator.getAuditReporter();
    for (const gate of autoPassGates) {
        if (!gate.required) continue;
        const result = orchestrator.transitionTask(orchestrationResult.task, gate.status);
        if (result.allowed && result.task) {
            orchestrationResult.task = result.task;
            reporter.recordGate(
                gate.gateName, gate.agentId, 'GO', [],
                orchestrationResult.task,
                `Gate automatico: ${gate.gateName} (sin revisiones pendientes)`,
                true,
            ).catch(() => undefined);
        }
    }

    // QA: solo posicionar en qa_review. El GO/NO-GO lo emite el reviewer real
    // (processQaEngineerResponse o processInlineQaReview), nunca este auto-avance.
    if (task.requiresQaApproval) {
        const toQa = orchestrator.transitionTask(orchestrationResult.task, 'qa_review');
        if (toQa.allowed && toQa.task) orchestrationResult.task = toQa.task;
    }
}

/**
 * Pide la pasada del agente qa-engineer cuando el estado de la tarea es qa_review
 * y el agente actual no es qa-engineer. Retorna el agente y el mensaje que debe
 * recibir, o null si no es necesario.
 */
export function activateQaEngineerIfNeeded(ctx: QaContext): { agentId: string; message: string } | null {
    const { orchestrationResult, noQA, clean, qaService, effectiveAgentId } = ctx;
    const qaAgentId = ctx.qaAgentId ?? 'qa-engineer';

    if (
        orchestrationResult.task.status !== 'qa_review' ||
        effectiveAgentId === qaAgentId ||
        noQA ||
        qaService.countCodeLines(clean) < MIN_CODE_LINES ||
        isInformationalRequest(orchestrationResult.task.rawPrompt)
    ) return null;

    if (!ctx.hasAgent(qaAgentId)) return null;

    return {
        agentId: qaAgentId,
        message: `Review the following generated code and determine whether it is ready to commit. ` +
                 `Your review is final and will be shown to the user.

${clean}`,
    };
}

/** Shared FSM transition + sprint completion logic for both QA paths. */
async function applyQaDecision(
    ctx: QaContext,
    approved: boolean,
    findings: AuditFinding[],
    gateNote: string,
    prependQaReview = false,
): Promise<void> {
    const { orchestrationResult, orchestrator } = ctx;
    const qaAgentId = ctx.qaAgentId ?? 'qa-engineer';
    const reporter = orchestrator.getAuditReporter();

    reporter.recordGate(
        'qa', qaAgentId,
        approved ? 'GO' : 'NO-GO condicional',
        findings,
        orchestrationResult.task,
        gateNote,
        true,
    ).catch(() => undefined);

    if (approved) {
        // Solo empujar por qa_review hacia approved cuando la tarea REQUIERE QA.
        // Una tarea sin gates requeridos puede commitear directamente (isCommitAllowed),
        // asi que no debemos fabricar un estado 'approved' a traves de un qa_review
        // que la tarea nunca necesito (H-004). La review inline igual queda registrada.
        if (
            prependQaReview &&
            orchestrationResult.task.requiresQaApproval &&
            orchestrationResult.task.status !== 'qa_review'
        ) {
            const toQa = orchestrator.transitionTask(orchestrationResult.task, 'qa_review');
            if (toQa.allowed && toQa.task) orchestrationResult.task = toQa.task;
        }
        const toApproved = orchestrator.transitionTask(orchestrationResult.task, 'approved');
        if (toApproved.allowed && toApproved.task) {
            orchestrationResult.task = toApproved.task;
            reporter.completeSprint({
                name:          orchestrationResult.task.rawPrompt?.slice(0, 48) ?? 'sprint',
                version:       '1.0.0',
                purpose:       orchestrationResult.task.rawPrompt ?? 'Implementacion automatica',
                newFiles:      [],
                modifiedFiles: [],
                testCount:     0,
                testTime:      '0s',
            }).catch(() => undefined);
        }
    } else {
        const rework = orchestrator.transitionTask(orchestrationResult.task, 'rework_required');
        if (rework.allowed && rework.task) {
            orchestrationResult.task = rework.task;
        } else if (rework.error?.startsWith('Límite de rework')) {
            // Rework agotado: la tarea se rechaza en lugar de quedar en qa_review para siempre
            const rejected = orchestrator.transitionTask(orchestrationResult.task, 'rejected');
            if (rejected.allowed && rejected.task) orchestrationResult.task = rejected.task;
        }
    }
}

/**
 * Procesa la respuesta del agente qa-engineer: registra el gate en AuditReporter,
 * transiciona el FSM a approved o rework_required y completa el sprint si aprueba.
 */
export async function processQaEngineerResponse(ctx: QaContext): Promise<void> {
    const { qaService, clean } = ctx;

    ctx.onQAReview?.(clean);

    const findings = normalizeFindings(qaService.extractFindings(clean));
    const approved = qaService.evaluateReview(clean);

    await applyQaDecision(ctx, approved, findings, 'QA review del agente qa-engineer (auto-activado)');
}

/**
 * Procesa QA review inline (sin activar qa-engineer como agente dedicado).
 * Usa QAService.reviewResponse() para obtener la revision y registra el gate.
 * Fallback para cuando qa-engineer no esta disponible o noQA es false.
 */
export async function processInlineQaReview(ctx: QaContext): Promise<void> {
    const { qaService, orchestrationResult, noQA } = ctx;

    // Apply the same guards as activateQaEngineerIfNeeded — skip for analysis/explanation
    // responses that have no substantial code, to avoid the QA agent saying "nothing to review"
    if (noQA) return;
    if (qaService.countCodeLines(ctx.clean) < MIN_CODE_LINES) return;
    if (isInformationalRequest(orchestrationResult.task.rawPrompt)) return;

    const review = await qaService.reviewResponse(ctx.clean);
    if (!review) return;

    ctx.onQAReview?.(review);

    const findings = normalizeFindings(qaService.extractFindings(review));
    const approved = qaService.evaluateReview(review);

    await applyQaDecision(ctx, approved, findings, 'QA review inline post-respuesta', true);
}
