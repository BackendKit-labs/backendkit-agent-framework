import type { OrchestratorConfig, AgentConfig } from './config.js';
import type { ExecutionResult } from './executor.js';
import { executeSubtask } from './executor.js';
import type { RoadmapPhase } from './roadmap-parser.js';
import { loadRoadmapPhases } from './roadmap-parser.js';
import type { PhaseState, QaVerdict, StepResult } from './run-store.js';
import { runProjectChecks, type ExecutionReport } from './command-runner.js';
import { updateProgressSummary }                   from './context-reader.js';
import { callMcpTool }                             from './mcp-client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PhaseRunnerOptions {
    config:       OrchestratorConfig;
    configDir?:   string;   // directory of orchestrator.yaml — needed to resolve MCP server paths
    projectRoot:  string;
    ragSearchFn?: (q: string) => Promise<string>;
    onProgress?:  (msg: string) => void;
}

/** A gate the phase-runner pauses on, asking the human to judge a QA verdict. */
export interface PhaseGate {
    type:            'phase-gate';
    phase:           number;
    phaseTitle:      string;
    verdict:         QaVerdict;
    qaOutput:        string;       // full QA report shown to the approver
    criteria:        string[];     // phase completion criteria
    allowRework:     boolean;
    executionReport?: ExecutionReport;  // real build+test results (undefined if runner unavailable)
}

export interface PhaseComplete {
    type:     'complete';
    summary:  string;
}

export type PhaseStep = PhaseGate | PhaseComplete;

// ── Agent resolution ──────────────────────────────────────────────────────────

function findAgent(config: OrchestratorConfig, domain: string): AgentConfig | undefined {
    return config.agents.find(a => a.domain === domain);
}

// ── QA verdict parsing ────────────────────────────────────────────────────────

/**
 * Extracts the QA verdict from the QA agent's markdown output.
 * Looks for "Veredicto:" / "Verdict:" followed by GO / NO GO / CONDITIONAL.
 */
export function parseVerdict(qaOutput: string): QaVerdict {
    // Priority 1: explicit structured line "VERDICT: NO_GO" (requested from QA soul)
    const structured = qaOutput.match(/^VERDICT:\s*(NO_GO|GO|CONDITIONAL)\s*$/im);
    if (structured) {
        const v = structured[1].toUpperCase();
        if (v === 'NO_GO') return 'NO_GO';
        if (v === 'CONDITIONAL') return 'CONDITIONAL';
        return 'GO';
    }

    // Priority 2: markdown header "**Veredicto:** ❌ NO GO"
    const header = qaOutput.match(/(?:veredicto|verdict)\s*:?\s*\*{0,2}\s*(✅|❌|⚠️)?\s*(NO[\s_-]?GO|GO|CONDITIONAL|CONDICIONAL)/i);
    if (header) {
        const v = header[2].toUpperCase().replace(/[\s-]/g, '_');
        if (v === 'NO_GO')                                           return 'NO_GO';
        if (v.startsWith('CONDITION') || v.startsWith('CONDICION')) return 'CONDITIONAL';
        return 'GO';
    }

    // Priority 3: emoji/keyword heuristics
    if (/❌|NO[\s_-]?GO/i.test(qaOutput))          return 'NO_GO';
    if (/⚠️|CONDITIONAL|CONDICIONAL/i.test(qaOutput)) return 'CONDITIONAL';
    return 'GO';
}

// ── PhaseRunner ───────────────────────────────────────────────────────────────

export class PhaseRunner {
    private readonly config:      OrchestratorConfig;
    private readonly configDir:   string;
    private readonly projectRoot: string;
    private readonly ragSearchFn: ((q: string) => Promise<string>) | undefined;
    private readonly onProgress:  (msg: string) => void;
    readonly phases:              RoadmapPhase[];

    constructor(opts: PhaseRunnerOptions) {
        this.config      = opts.config;
        this.configDir   = opts.configDir ?? process.cwd();
        this.projectRoot = opts.projectRoot;
        this.ragSearchFn = opts.ragSearchFn;
        this.onProgress  = opts.onProgress ?? (() => {});
        this.phases      = loadRoadmapPhases(opts.projectRoot);
    }

    // ── MCP dispatch or inline fallback ────────────────────────────────────────

    private async callAgent(
        agentId:  string,
        toolName: string,
        args:     Record<string, unknown>,
        // Inline fallback params
        inlineTask: string,
        phaseCtx?: PhaseContext,
    ): Promise<string> {
        const agentCfg = findAgent(this.config, agentId.replace('-mcp', ''))
                      ?? this.config.agents.find(a => a.id === agentId);
        if (!agentCfg) throw new Error(`Agente "${agentId}" no encontrado en la config`);

        // MCP mode: spawn the specialist process and call the tool
        if (agentCfg.transport?.type === 'stdio') {
            return callMcpTool(agentCfg, toolName, args, this.configDir, this.onProgress);
        }

        // Inline fallback: LLM call with soul file prompt
        this.onProgress(`  ⚠ [${agentId}] sin transport stdio — usando modo inline`);
        const subtask = { id: toolName, agent_id: agentCfg.id, task: inlineTask, depends_on: [] };
        return executeSubtask(this.config, agentCfg, subtask, [], this.ragSearchFn, undefined, this.projectRoot, this.onProgress, phaseCtx);
    }

    hasPhases(): boolean { return this.phases.length > 0; }

    /** Initial phase state at the start of a phased run. */
    initialState(): PhaseState {
        const first = this.phases[0];
        return {
            currentPhase: 1,
            totalPhases:  this.phases.length,
            phaseTitle:   first?.title ?? 'Phase 1',
            stage:        'implement',
            reworkCount:  0,
            phaseTitles:  this.phases.map(p => p.title),
        };
    }

    /**
     * Runs the implement → QA cycle for the current phase and returns either:
     *  - a PhaseGate (human must judge the QA verdict), or
     *  - a PhaseComplete (all phases done + security + infra finished).
     *
     * `state` is mutated to reflect progress; the caller persists it.
     * `collectStep` is called for each agent step so the caller can record results.
     */
    async runCurrentPhase(
        state:       PhaseState,
        collectStep: (step: StepResult) => void,
    ): Promise<PhaseStep> {
        // Once all phases are approved, advance() sets stage to security/infra/done.
        // Go straight to finalizers — do NOT re-run the last phase.
        if (state.stage === 'security' || state.stage === 'infra' || state.stage === 'done') {
            return this.runFinalizers(state, collectStep);
        }

        const phase = this.phases[state.currentPhase - 1];
        if (!phase) {
            // Defensive: pointer past the end → finalizers
            return this.runFinalizers(state, collectStep);
        }

        // ── 1. IMPLEMENT ──────────────────────────────────────────────────────
        state.stage = 'implement';
        const backend = findAgent(this.config, 'backend');
        if (!backend) throw new Error('No hay agente con domain "backend" configurado');

        const reworkNote = state.qaFindings
            ? `\n\n⚠️ ESTA ES UNA RE-IMPLEMENTACIÓN (rework). El QA RECHAZÓ la versión anterior.\n` +
              `Corregí EXACTAMENTE estos hallazgos del QA:\n${state.qaFindings}\n\n` +
              `REGLAS DEL REWORK (obligatorias):\n` +
              `1. RE-EMITÍ los archivos COMPLETOS con el formato "### FILE: path" — NO describas cambios, NO uses diffs, NO digas "agregá esto". Escribí el archivo entero de nuevo.\n` +
              `2. Si falta un archivo (ej: tests), CREALO completo con "### FILE: path".\n` +
              `3. Cada hallazgo ❌ del QA debe quedar resuelto por un archivo que emitas ahora.\n` +
              `4. Mantené el código que ya estaba bien — re-emitilo igual para no perderlo.`
            : '';

        const implTask =
            `Implementá la Fase ${phase.number} del ROADMAP: "${phase.title}".\n\n` +
            `Detalle de la fase:\n${phase.body}${reworkNote}`;

        this.onProgress(`\n📍 Fase ${phase.number}/${this.phases.length}: ${phase.title}` +
            (state.reworkCount > 0 ? `  (rework #${state.reworkCount})` : ''));
        this.onProgress(`  → [backend] implementando...`);

        const phaseCtx = { number: phase.number, title: phase.title, criteria: phase.criteria };

        let implOutput = await this.callAgent(
            backend.id,
            'implement_phase',
            { projectRoot: this.projectRoot, phaseNumber: phase.number, phaseTitle: phase.title, criteria: phase.criteria, reworkFindings: state.qaFindings },
            implTask,
            phaseCtx,
        );

        // Tarea 2.3: retry solo en modo inline — en modo MCP el agente escribe archivos
        // directamente con write_file(), el output es un resumen de texto sin bloques FILE:
        const isMcpMode = !!backend.transport && backend.transport.type === 'stdio';
        if (!isMcpMode) {
            const { extractFiles } = await import('./file-writer.js');
            if (extractFiles(implOutput).length === 0) {
                this.onProgress(`  ⚠ 0 archivos extraídos — reintentando con instrucción reforzada...`);
                const retryTask = implTask +
                    `\n\nATENCIÓN: Tu respuesta anterior no incluyó ningún bloque ### FILE:. ` +
                    `Debés responder ÚNICAMENTE con los archivos en el formato:\n` +
                    `### FILE: src/ruta/archivo.ext\n\`\`\`lang\ncontenido completo\n\`\`\`\n` +
                    `Sin explicaciones. Solo los archivos.`;
                implOutput = await executeSubtask(
                    this.config, backend,
                    { id: `impl-p${phase.number}-retry`, agent_id: backend.id, task: retryTask, depends_on: [] },
                    [], this.ragSearchFn, undefined, this.projectRoot, this.onProgress,
                );
            }
        }

        collectStep({
            stepId: `impl-p${phase.number}${state.reworkCount > 0 ? `-rw${state.reworkCount}` : ''}`,
            agentId: backend.id, task: `Implementar Fase ${phase.number}: ${phase.title}`,
            output: implOutput, success: true, durationMs: 0,
        });

        // ── 2. BUILD + TEST (execution gate — deterministic) ─────────────────
        // The execution result IS the verdict. If build/tests fail → NO_GO.
        // The QA LLM is optional and triggered on demand via queryQA().
        state.stage = 'qa';
        this.onProgress(`  → [exec] compilando y testeando...`);

        let execReport: ExecutionReport | undefined;
        try {
            execReport = await runProjectChecks(this.projectRoot, this.onProgress);
        } catch {
            // execution check failed to launch — degrade gracefully, continue to LLM QA
        }

        if (execReport && !execReport.passed) {
            // Build or tests failed: automatic NO_GO — the QA LLM is not called here.
            // The human can optionally trigger it via [Q] in the gate prompt.
            const verdict: QaVerdict = 'NO_GO';
            state.verdict    = verdict;
            state.qaFindings = execReport.summary;

            const autoReport = [
                `# QA Report — Fase ${phase.number} (automático)`,
                `**Veredicto:** ❌ NO GO (build/tests fallaron)`,
                '',
                '## Resultado de ejecución',
                execReport.summary,
                '',
                'VERDICT: NO_GO',
            ].join('\n');

            collectStep({
                stepId:  `qa-p${phase.number}${state.reworkCount > 0 ? `-rw${state.reworkCount}` : ''}`,
                agentId: 'exec', task: `Ejecución Fase ${phase.number}: ${phase.title}`,
                output:  autoReport, success: false, durationMs: 0,
            });

            this.onProgress(`  ❌ NO GO — build/tests fallaron (usá [Q] para consultar al QA)`);

            return {
                type: 'phase-gate', phase: phase.number, phaseTitle: phase.title,
                verdict, qaOutput: autoReport, criteria: phase.criteria,
                allowRework: true, executionReport: execReport,
            };
        }

        // ── 3. QA (LLM) — runs only when build+tests pass ────────────────────
        const qa = findAgent(this.config, 'qa');
        if (!qa) throw new Error('No hay agente con domain "qa" configurado');

        const execContext = execReport
            ? `\n## Resultado de ejecución real (build + tests)\n${execReport.summary}\n`
            : '';

        const qaTask =
            `Validá la implementación de la Fase ${phase.number}: "${phase.title}" contra la specification.md.\n\n` +
            `Criterios de esta fase a verificar:\n${phase.criteria.map(c => `- ${c}`).join('\n')}` +
            execContext +
            `\nGenerá el reporte qa-phase${phase.number}.md.\n` +
            `Terminá SIEMPRE con una línea exacta: VERDICT: GO | VERDICT: NO_GO | VERDICT: CONDITIONAL`;

        this.onProgress(`  → [qa] validando fase ${phase.number}...`);

        const qaOutput = await this.callAgent(
            qa.id,
            'validate_phase',
            { projectRoot: this.projectRoot, phaseNumber: phase.number, phaseTitle: phase.title, criteria: phase.criteria, execReport: execReport?.summary },
            qaTask,
            phaseCtx,
        );
        collectStep({
            stepId: `qa-p${phase.number}${state.reworkCount > 0 ? `-rw${state.reworkCount}` : ''}`,
            agentId: qa.id, task: `QA Fase ${phase.number}: ${phase.title}`,
            output: qaOutput, success: true, durationMs: 0,
        });

        const verdict = parseVerdict(qaOutput);
        state.verdict = verdict;
        this.onProgress(`  ${verdict === 'GO' ? '✅' : verdict === 'NO_GO' ? '❌' : '⚠️'} QA veredicto: ${verdict}`);

        // ── 4. GATE ───────────────────────────────────────────────────────────
        return {
            type: 'phase-gate', phase: phase.number, phaseTitle: phase.title,
            verdict, qaOutput, criteria: phase.criteria,
            allowRework: true, executionReport: execReport,
        };
    }

    /**
     * Advances state after a gate decision.
     *  - 'approve': clear findings, move to next phase (or finalizers if last).
     *  - 'rework':  keep phase, store findings for re-implementation.
     */
    advance(state: PhaseState, decision: 'approve' | 'rework', qaOutput: string): void {
        if (decision === 'rework') {
            state.reworkCount += 1;
            state.qaFindings   = qaOutput;
            state.stage        = 'implement';
            return;
        }
        // approve — write progress summary (3.3) before advancing
        const completedPhase = this.phases[state.currentPhase - 1];
        if (completedPhase) {
            updateProgressSummary(
                this.projectRoot,
                completedPhase.number,
                completedPhase.title,
                `✅ ${qaOutput.slice(0, 80).replace(/\n/g, ' ')}`,
            );
        }

        state.qaFindings  = undefined;
        state.reworkCount = 0;
        state.verdict     = undefined;
        if (state.currentPhase < this.phases.length) {
            state.currentPhase += 1;
            state.phaseTitle = this.phases[state.currentPhase - 1].title;
            state.stage      = 'implement';
        } else {
            state.stage = 'security';
        }
    }

    /**
     * Runs security review + infra generation once all phases pass.
     * These are non-gated finalizers — they run and the run completes.
     */
    private async runFinalizers(
        state:       PhaseState,
        collectStep: (step: StepResult) => void,
    ): Promise<PhaseComplete> {
        const security = findAgent(this.config, 'security');
        if (security && state.stage !== 'infra' && state.stage !== 'done') {
            state.stage = 'security';
            this.onProgress(`\n🔒 Security review final...`);
            const secTask = 'Revisá todo el código implementado en src/ buscando vulnerabilidades OWASP. Generá security-review.md.';
            const out = await this.callAgent(security.id, 'security_review_project', { projectRoot: this.projectRoot }, secTask);
            collectStep({ stepId: 'security-final', agentId: security.id, task: 'Security review final', output: out, success: true, durationMs: 0 });
        }

        const infra = findAgent(this.config, 'infra');
        if (infra) {
            state.stage = 'infra';
            this.onProgress(`\n🐳 Generando infraestructura...`);
            const infraTask = 'Generá la configuración de infraestructura: Dockerfile, docker-compose.yml, CI/CD y manifiestos K8s.';
            const out = await this.callAgent(infra.id, 'generate_infra', { projectRoot: this.projectRoot }, infraTask);
            collectStep({ stepId: 'infra-final', agentId: infra.id, task: 'Infraestructura', output: out, success: true, durationMs: 0 });
        }

        state.stage = 'done';
        return {
            type:    'complete',
            summary: `SDD completado: ${this.phases.length} fases implementadas y validadas, security review + infra generados.`,
        };
    }

    // ── On-demand QA analysis ──────────────────────────────────────────────────

    /**
     * Optional QA analysis triggered manually from the gate.
     * @param phaseNumber  Phase to analyze (uses phases[n-1]).
     * @param question     Specific question. Empty string = general review.
     * @param execReport   Execution context (build/test results) if available.
     */
    async queryQA(
        phaseNumber: number,
        question:    string,
        execReport?: ExecutionReport,
        onProgress?: (msg: string) => void,
    ): Promise<string> {
        const qa = findAgent(this.config, 'qa');
        if (!qa) throw new Error('No hay agente QA configurado');

        const phase = this.phases[phaseNumber - 1];
        if (!phase) throw new Error(`Fase ${phaseNumber} no encontrada en el ROADMAP`);

        const log       = onProgress ?? this.onProgress;
        const phaseCtx  = { number: phase.number, title: phase.title, criteria: phase.criteria };
        const execCtx   = execReport ? `\n## Resultado de ejecución\n${execReport.summary}\n` : '';
        const isGeneral = !question.trim();

        const prompt = isGeneral
            ? `Hacé una revisión general de la Fase ${phase.number}: "${phase.title}" contra la specification.md.\n\n` +
              `Criterios:\n${phase.criteria.map(c => `- ${c}`).join('\n')}${execCtx}\n` +
              `Respondé de forma clara y concisa. Indicá qué está bien y qué hay que corregir.`
            : `Analizá la Fase ${phase.number}: "${phase.title}".\n\n` +
              `Pregunta: **${question}**\n${execCtx}\n` +
              `Respondé de forma concisa y específica, citando el archivo y la línea relevante cuando sea posible.`;

        log(`  → [qa] analizando${isGeneral ? ' (revisión general)' : `: "${question.slice(0, 60)}"`}...`);

        // Uses inline mode for on-demand queries — fast, no MCP process overhead
        return executeSubtask(
            this.config, qa,
            { id: `qa-query-p${phase.number}`, agent_id: qa.id, task: prompt, depends_on: [] },
            [], this.ragSearchFn, undefined, this.projectRoot, log, phaseCtx,
        );
    }
}
