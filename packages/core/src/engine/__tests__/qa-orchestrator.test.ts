import { advanceRequiredGates, processInlineQaReview } from '../qa-orchestrator';
import { TaskFSM } from '../../orchestration/fsm';
import { createTaskContext, type TaskContext, type TaskStatus } from '../../orchestration/task-context';
import type { OrchestrationResult } from '../../orchestration/types';
import type { Orchestrator } from '../../orchestration/orchestrator';
import type { QAService } from '../../qa/qa-service';
import type { QaContext } from '../qa-orchestrator';

// ── Harness ─────────────────────────────────────────────────────────────────

/** Builds a real FSM-backed orchestrator stub plus spies for the audit reporter. */
function makeOrchestrator() {
    const fsm = new TaskFSM();
    const recordGate = jest.fn().mockResolvedValue('');
    const completeSprint = jest.fn().mockResolvedValue(undefined);
    const reporter = { recordGate, completeSprint };
    const orchestrator = {
        transitionTask: (task: TaskContext, to: TaskStatus) => fsm.transition(task, to),
        getAuditReporter: () => reporter,
    } as unknown as Orchestrator;
    return { orchestrator, recordGate, completeSprint };
}

function makeQaService(overrides: Partial<Record<keyof QAService, unknown>> = {}) {
    return {
        countCodeLines: jest.fn().mockReturnValue(20),
        reviewResponse: jest.fn().mockResolvedValue('aprobado, se ve bien'),
        evaluateReview: jest.fn().mockReturnValue(true),
        extractFindings: jest.fn().mockReturnValue([]),
        ...overrides,
    } as unknown as QAService;
}

function makeResult(task: TaskContext): OrchestrationResult {
    return {
        task,
        selectedAgents: [],
        appliedPolicies: [],
        requiredGates: [],
        commitAllowed: false,
    };
}

interface CtxOpts {
    task: TaskContext;
    qaService?: QAService;
    orchestrator?: ReturnType<typeof makeOrchestrator>['orchestrator'];
    clean?: string;
}

function makeCtx(opts: CtxOpts): QaContext {
    return {
        clean: opts.clean ?? '```ts\nconst x = 1;\n```',
        orchestrationResult: makeResult(opts.task),
        orchestrator: opts.orchestrator!,
        qaService: opts.qaService!,
        allAgents: [],
        messages: [],
        effectiveAgentId: 'backend',
        setEffectiveAgent: jest.fn(),
    };
}

/** A task fresh out of implementation with substantial, non-informational code. */
function implTask(flags: Partial<Pick<TaskContext,
    'requiresArchitectureReview' | 'requiresSecurityReview' | 'requiresQaApproval'>> = {}): TaskContext {
    const task = createTaskContext('Implementar el endpoint de pagos');
    task.status = 'implementation';
    task.requiresArchitectureReview = flags.requiresArchitectureReview ?? false;
    task.requiresSecurityReview = flags.requiresSecurityReview ?? false;
    task.requiresQaApproval = flags.requiresQaApproval ?? false;
    return task;
}

const gatesRecorded = (recordGate: jest.Mock): string[] =>
    recordGate.mock.calls.map(c => c[0] as string);

// ── H-003: advanceRequiredGates respeta los flags requiresX ──────────────────

describe('advanceRequiredGates (H-003)', () => {
    it('no transiciona ni registra gates cuando la tarea no requiere ninguno', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService();
        const ctx = makeCtx({ task: implTask(), orchestrator, qaService });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('implementation');
        expect(recordGate).not.toHaveBeenCalled();
    });

    it('solo avanza/registra el gate de QA cuando solo requiresQaApproval', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService();
        const ctx = makeCtx({ task: implTask({ requiresQaApproval: true }), orchestrator, qaService });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('qa_review');
        expect(gatesRecorded(recordGate)).toEqual(['qa']);
    });

    it('registra architecture pero NO security/qa cuando solo requiresArchitectureReview', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService();
        const ctx = makeCtx({ task: implTask({ requiresArchitectureReview: true }), orchestrator, qaService });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('design_review');
        expect(gatesRecorded(recordGate)).toEqual(['architecture']);
    });

    it('avanza security y qa (en orden) cuando ambos son requeridos, satisfaciendo el guard del FSM', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService();
        const ctx = makeCtx({
            task: implTask({ requiresSecurityReview: true, requiresQaApproval: true }),
            orchestrator, qaService,
        });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('qa_review');
        expect(gatesRecorded(recordGate)).toEqual(['security', 'qa']);
    });

    it('no hace nada con código trivial (< 8 líneas)', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService({ countCodeLines: jest.fn().mockReturnValue(3) });
        const ctx = makeCtx({ task: implTask({ requiresQaApproval: true }), orchestrator, qaService });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('implementation');
        expect(recordGate).not.toHaveBeenCalled();
    });

    it('no hace nada en solicitudes informativas', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService();
        const task = implTask({ requiresQaApproval: true });
        task.rawPrompt = 'explica cómo funciona el flujo de pagos';
        const ctx = makeCtx({ task, orchestrator, qaService });

        await advanceRequiredGates(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('implementation');
        expect(recordGate).not.toHaveBeenCalled();
    });
});

// ── H-004: processInlineQaReview no fuerza qa_review cuando no se requiere ────

describe('processInlineQaReview (H-004)', () => {
    it('NO fuerza qa_review→approved cuando la tarea no requiere QA (review informativa)', async () => {
        const { orchestrator, recordGate, completeSprint } = makeOrchestrator();
        const qaService = makeQaService(); // review aprobada por defecto
        const ctx = makeCtx({ task: implTask(), orchestrator, qaService });

        await processInlineQaReview(ctx);

        // El estado NO debe avanzar a approved: una tarea sin gates commitea directo.
        expect(ctx.orchestrationResult.task.status).toBe('implementation');
        // Pero la review inline sí queda registrada como gate de QA.
        expect(gatesRecorded(recordGate)).toEqual(['qa']);
        expect(completeSprint).not.toHaveBeenCalled();
    });

    it('sí avanza qa_review→approved cuando la tarea requiere QA y la review aprueba', async () => {
        const { orchestrator, completeSprint } = makeOrchestrator();
        const qaService = makeQaService();
        const ctx = makeCtx({ task: implTask({ requiresQaApproval: true }), orchestrator, qaService });

        await processInlineQaReview(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('approved');
        expect(completeSprint).toHaveBeenCalledTimes(1);
    });

    it('transiciona a rework_required cuando la review rechaza', async () => {
        const { orchestrator, completeSprint } = makeOrchestrator();
        const qaService = makeQaService({ evaluateReview: jest.fn().mockReturnValue(false) });
        const ctx = makeCtx({ task: implTask({ requiresQaApproval: true }), orchestrator, qaService });

        await processInlineQaReview(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('rework_required');
        expect(completeSprint).not.toHaveBeenCalled();
    });

    it('hace early-return sin tocar el estado cuando no hay review disponible', async () => {
        const { orchestrator, recordGate } = makeOrchestrator();
        const qaService = makeQaService({ reviewResponse: jest.fn().mockResolvedValue(null) });
        const ctx = makeCtx({ task: implTask({ requiresQaApproval: true }), orchestrator, qaService });

        await processInlineQaReview(ctx);

        expect(ctx.orchestrationResult.task.status).toBe('implementation');
        expect(recordGate).not.toHaveBeenCalled();
    });
});
