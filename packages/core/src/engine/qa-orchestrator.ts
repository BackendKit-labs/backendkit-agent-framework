import type { AgentProfile, LLMMessage } from '../types';
import type { Orchestrator } from '../orchestration/orchestrator';
import type { OrchestrationResult } from '../orchestration/types';
import type { TaskStatus } from '../orchestration/task-context';
import type { QAService } from '../qa/qa-service';
import type { AuditFinding } from '../orchestration/audit';
import type { AuditFinding as ReflectionFinding } from '../reflection/types';

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
    allAgents: AgentProfile[];
    messages: LLMMessage[];
    effectiveAgentId: string;
    /** Agent ID to restore after QA finishes. Defaults to 'general' when omitted. */
    defaultAgentId?: string;
    /** Agent ID for the QA reviewer. Defaults to 'qa-engineer' when omitted. */
    qaAgentId?: string;
    noQA?: boolean;
    onQAReview?: (review: string) => void;
    setEffectiveAgent: (agentId: string) => void;
}

/**
 * Auto-avanza los gates requeridos (design_review, security_review, qa_review)
 * registrando GO silencioso cuando no hay hallazgos. Solo actua si la respuesta
 * tiene codigo sustancial (>= 8 lineas).
 */
export async function advanceRequiredGates(ctx: QaContext): Promise<void> {
    const { orchestrationResult, orchestrator, qaService, clean } = ctx;
    if (qaService.countCodeLines(clean) < MIN_CODE_LINES) return;
    if (isInformationalRequest(orchestrationResult.task.rawPrompt)) return;

    const qaAgentId = ctx.qaAgentId ?? 'qa-engineer';
    const gates: Array<{ status: TaskStatus; gateName: string; agentId: string }> = [
        { status: 'design_review',   gateName: 'architecture', agentId: 'architecture' },
        { status: 'security_review', gateName: 'security',     agentId: 'security' },
        { status: 'qa_review',       gateName: 'qa',           agentId: qaAgentId },
    ];

    const reporter = orchestrator.getAuditReporter();
    for (const gate of gates) {
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
}

/**
 * Activa el agente qa-engineer cuando el estado de la tarea es qa_review
 * y el agente actual no es qa-engineer. Retorna el perfil del QA si activo,
 * null si no es necesario.
 */
export function activateQaEngineerIfNeeded(ctx: QaContext): AgentProfile | null {
    const { orchestrationResult, allAgents, noQA, clean, qaService, effectiveAgentId } = ctx;
    const qaAgentId = ctx.qaAgentId ?? 'qa-engineer';

    if (
        orchestrationResult.task.status !== 'qa_review' ||
        effectiveAgentId === qaAgentId ||
        noQA ||
        qaService.countCodeLines(clean) < MIN_CODE_LINES ||
        isInformationalRequest(orchestrationResult.task.rawPrompt)
    ) return null;

    const qaProfile = allAgents.find(a => a.id === qaAgentId);
    if (!qaProfile) return null;

    ctx.messages.push({
        role: 'user',
        content: `Revisa el siguiente codigo generado y determina si es apto para commit. ` +
                 `Tu revision es la ultima palabra y sera visible para el usuario.\n\n${clean}`,
    });
    ctx.setEffectiveAgent(qaAgentId);
    return qaProfile;
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
        if (prependQaReview) {
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
        if (rework.allowed && rework.task) orchestrationResult.task = rework.task;
    }
}

/**
 * Procesa la respuesta del agente qa-engineer: registra el gate en AuditReporter,
 * transiciona el FSM a approved o rework_required, completa el sprint si aprueba
 * y resetea el agente efectivo al agente por defecto.
 */
export async function processQaEngineerResponse(ctx: QaContext): Promise<void> {
    const { qaService, clean } = ctx;

    ctx.onQAReview?.(clean);

    const findings = normalizeFindings(qaService.extractFindings(clean));
    const approved = qaService.evaluateReview(clean);

    await applyQaDecision(ctx, approved, findings, 'QA review del agente qa-engineer (auto-activado)');

    ctx.setEffectiveAgent(ctx.defaultAgentId ?? 'general');
}

/**
 * Procesa QA review inline (sin activar qa-engineer como agente dedicado).
 * Usa QAService.reviewResponse() para obtener la revision y registra el gate.
 * Fallback para cuando qa-engineer no esta disponible o noQA es false.
 */
export async function processInlineQaReview(ctx: QaContext): Promise<void> {
    const { qaService } = ctx;

    const review = await qaService.reviewResponse(ctx.clean);
    if (!review) return;

    ctx.onQAReview?.(review);

    const findings = normalizeFindings(qaService.extractFindings(review));
    const approved = qaService.evaluateReview(review);

    await applyQaDecision(ctx, approved, findings, 'QA review inline post-respuesta', true);
}
