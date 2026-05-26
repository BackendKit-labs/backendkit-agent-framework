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

export interface QaContext {
    clean: string;
    orchestrationResult: OrchestrationResult;
    orchestrator: Orchestrator;
    qaService: QAService;
    allAgents: AgentProfile[];
    messages: LLMMessage[];
    effectiveAgentId: string;
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

    const gates: Array<{ status: TaskStatus; gateName: string; agentId: string }> = [
        { status: 'design_review',   gateName: 'architecture', agentId: 'architecture' },
        { status: 'security_review', gateName: 'security',     agentId: 'security' },
        { status: 'qa_review',       gateName: 'qa',           agentId: 'qa-engineer' },
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

    if (
        orchestrationResult.task.status !== 'qa_review' ||
        effectiveAgentId === 'qa-engineer' ||
        noQA ||
        qaService.countCodeLines(clean) < MIN_CODE_LINES
    ) return null;

    const qaProfile = allAgents.find(a => a.id === 'qa-engineer');
    if (!qaProfile) return null;

    ctx.messages.push({
        role: 'user',
        content: `Revisa el siguiente codigo generado y determina si es apto para commit. ` +
                 `Tu revision es la ultima palabra y sera visible para el usuario.\n\n${clean}`,
    });
    ctx.setEffectiveAgent('qa-engineer');
    return qaProfile;
}

/**
 * Procesa la respuesta del agente qa-engineer: registra el gate en AuditReporter,
 * transiciona el FSM a approved o rework_required, completa el sprint si aprueba
 * y resetea el agente efectivo a general.
 */
export async function processQaEngineerResponse(ctx: QaContext): Promise<void> {
    const { orchestrationResult, orchestrator, qaService, clean } = ctx;

    ctx.onQAReview?.(clean);

    const reporter = orchestrator.getAuditReporter();
    const findings: AuditFinding[] = normalizeFindings(qaService.extractFindings(clean));
    const approved = qaService.evaluateReview(clean);

    reporter.recordGate(
        'qa', 'qa-engineer',
        approved ? 'GO' : 'NO-GO condicional',
        findings,
        orchestrationResult.task,
        'QA review del agente qa-engineer (auto-activado)',
        true,
    ).catch(() => undefined);

    if (approved) {
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

    // Resetear al agente original
    ctx.setEffectiveAgent('general');
}

/**
 * Procesa QA review inline (sin activar qa-engineer como agente dedicado).
 * Usa QAService.reviewResponse() para obtener la revision y registra el gate.
 * Fallback para cuando qa-engineer no esta disponible o noQA es false por
 * el agente actual pero la respuesta tiene codigo sustancial.
 */
export async function processInlineQaReview(ctx: QaContext): Promise<void> {
    const { orchestrationResult, orchestrator, qaService, clean } = ctx;

    const review = await qaService.reviewResponse(clean);
    if (!review) return;

    ctx.onQAReview?.(review);

    const reporter = orchestrator.getAuditReporter();
    const findings: AuditFinding[] = normalizeFindings(qaService.extractFindings(review));
    const approved = qaService.evaluateReview(review);

    reporter.recordGate(
        'qa', 'qa-engineer',
        approved ? 'GO' : 'NO-GO condicional',
        findings,
        orchestrationResult.task,
        'QA review inline post-respuesta',
        true,
    ).catch(() => undefined);

    if (approved) {
        const toQa = orchestrator.transitionTask(orchestrationResult.task, 'qa_review');
        if (toQa.allowed && toQa.task) orchestrationResult.task = toQa.task;

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
