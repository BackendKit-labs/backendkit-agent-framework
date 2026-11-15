/**
 * @description Orquestador principal — Pipeline completo de clasificación.
 * 
 * Integra: Intent Detection → Domain Detection → Risk Scoring → Policy Engine
 * 
 * Cada etapa enriquece el TaskContext progresivamente.
 * El resultado final contiene los agentes seleccionados, políticas aplicadas
 * y gates requeridos para proceder.
 * 
 * @example
 * ```ts
 * const orchestrator = new Orchestrator(client, config);
 * const result = await orchestrator.orchestrate('Agregar circuit breaker para ServiceNow');
 * // result.task.actionType === 'implementation'
 * // result.task.domains === ['resilience', 'backend']
 * // result.task.riskLevel === 'high'
 * // result.selectedAgents === ['architecture', 'backend-agent', 'qa-engineer']
 * ```
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'yaml';
import { pipeline, Ok, Err } from '@backendkit-labs/pipeline';
import type { PipelineStep, StepResult } from '@backendkit-labs/pipeline';

import { createTaskContext, TaskContext, TaskStatus } from './task-context';
import { enrichTaskWithIntent, LLMChatClient } from './intent-detector';
import { enrichTaskWithDomains } from './domain-detector';
import { enrichTaskWithRisk } from './risk-scorer';
import { applyPolicies, PolicyEngineResult } from './policy-engine';
import { resolveGates } from './gate-resolver';
import { TaskFSM, FSMTransitionResult } from './fsm';
import {
  OrchestratorConfig,
  OrchestrationResult,
  PolicyRule,
  CapabilityMatrix,
  defaultOrchestratorConfig,
} from './types';
import { AuditReporter } from './audit-reporter';
import type { GateVeredict, AuditFinding } from './audit';

// ── Pipeline context ──────────────────────────────────────────────────────────

type OrchestratorCtx = {
  task: TaskContext;
  policyResult: PolicyEngineResult;
};

const EMPTY_POLICY_RESULT: PolicyEngineResult = {
  mustInclude: [],
  requiredGates: [],
  mustExecute: [],
  customGates: [],
  appliedRules: [],
};

// ── Enrichment steps ──────────────────────────────────────────────────────────

class IntentStep implements PipelineStep<OrchestratorCtx, Error> {
  readonly stepName = 'intent-detection';
  constructor(private client?: LLMChatClient) {}
  async handle(ctx: OrchestratorCtx): Promise<StepResult<OrchestratorCtx, Error>> {
    try {
      return Ok({ ...ctx, task: await enrichTaskWithIntent(ctx.task, this.client) });
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

class DomainStep implements PipelineStep<OrchestratorCtx, Error> {
  readonly stepName = 'domain-detection';
  async handle(ctx: OrchestratorCtx): Promise<StepResult<OrchestratorCtx, Error>> {
    return Ok({ ...ctx, task: enrichTaskWithDomains(ctx.task) });
  }
}

class RiskStep implements PipelineStep<OrchestratorCtx, Error> {
  readonly stepName = 'risk-scoring';
  constructor(private config: OrchestratorConfig) {}
  async handle(ctx: OrchestratorCtx): Promise<StepResult<OrchestratorCtx, Error>> {
    return Ok({ ...ctx, task: enrichTaskWithRisk(ctx.task, this.config) });
  }
}

class PolicyStep implements PipelineStep<OrchestratorCtx, Error> {
  readonly stepName = 'policy-engine';
  constructor(
    private customRules: PolicyRule[] | undefined,
    private loadManifest: () => Promise<PolicyRule[]>,
    private input: string,
    private includeDefaultRules: boolean,
  ) {}
  async handle(ctx: OrchestratorCtx): Promise<StepResult<OrchestratorCtx, Error>> {
    try {
      const manifestRules = await this.loadManifest();
      const mergedRules = [...(this.customRules ?? []), ...manifestRules];
      const result = applyPolicies(
        ctx.task,
        mergedRules.length > 0 ? mergedRules : undefined,
        this.input,
        this.includeDefaultRules,
      );
      return Ok({ task: result.task, policyResult: result.result });
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

/** Agent IDs used for the review/verify phases of the auto-built pipeline. Defaults match agent-coding's builtin roster. */
export interface ReviewAgentIds {
  security?: string;
  architecture?: string;
  qa?: string;
}

const DEFAULT_REVIEW_AGENTS: Required<ReviewAgentIds> = {
  security: 'security',
  architecture: 'architecture',
  qa: 'qa-engineer',
};

// ── Public re-exports ─────────────────────────────────────────────────────────

export type { OrchestratorConfig, OrchestrationResult, PolicyRule, CapabilityMatrix };
export { defaultOrchestratorConfig } from './types';
export { detectIntent, enrichTaskWithIntent } from './intent-detector';
export { detectDomains, enrichTaskWithDomains } from './domain-detector';
export { calculateRisk, enrichTaskWithRisk } from './risk-scorer';
export { evaluatePolicies, applyPolicies } from './policy-engine';
export { TaskFSM } from './fsm';
export type { FSMTransitionResult } from './fsm';
export { createTaskContext } from './task-context';
export type { TaskContext } from './task-context';
export { AuditReporter } from './audit-reporter';
export type { AuditFinding, GateVeredict } from './audit';

/**
 * @description Orquestador central del sistema multi-agente.
 * 
 * Procesa el input del usuario a través de un pipeline de 4 etapas:
 * 1. Intent Detection — clasifica la acción (design, implement, etc.)
 * 2. Domain Detection — identifica bounded contexts
 * 3. Risk Scoring — calcula nivel de riesgo técnico
 * 4. Policy Engine — aplica reglas y determina agentes/gates
 * 
 * El resultado es un OrchestrationResult que el AgentLoop puede usar
 * para seleccionar agentes, aplicar gates y controlar el flujo.
 * 
 * **Auditoría integrada:**
 * Cada vez que `orchestrate()` se ejecuta, el AuditReporter registra
 * automáticamente un gate de orquestación con los hallazgos detectados.
 * 
 * Los gates de QA, security y architecture se registran desde el AgentLoop
 * usando `getAuditReporter()`.
 */
export class Orchestrator {
  private client?: LLMChatClient;
  private config: OrchestratorConfig;
  private customRules?: PolicyRule[];
  private capabilityMatrix?: CapabilityMatrix;
  private includeDefaultRules: boolean;
  private reviewAgents: Required<ReviewAgentIds>;
  private customGateAgents?: Record<string, string>;
  private fsm: TaskFSM;
  private auditReporter: AuditReporter;
  private appName: string;

  constructor(options?: {
    client?: LLMChatClient;
    config?: OrchestratorConfig;
    customRules?: PolicyRule[];
    capabilityMatrix?: CapabilityMatrix;
    /**
     * Whether to include the built-in DEFAULT_RULES (policy-engine.ts), which assume
     * agent-coding's roster (architecture/security/qa-engineer). Default true — no
     * behavior change for existing callers. Verticals without those agents (e.g.
     * agent-enterprise) should pass false and supply their own customRules.
     */
    includeDefaultRules?: boolean;
    /** Agent IDs for the auto-built review/verify pipeline. Defaults to agent-coding's roster. */
    reviewAgents?: ReviewAgentIds;
    /**
     * Mapa nombre-de-customGate → agentId, para task.customGates (gates con nombre abierto,
     * más allá de architecture/security/qa). Si un gate no tiene entrada acá, se usa su
     * propio nombre como agentId.
     */
    customGateAgents?: Record<string, string>;
    /** Ruta raíz del proyecto para los informes de auditoría (default: process.cwd()) */
    projectRoot?: string;
    /** App name para derivar ~/.{appName}/projects/ (default: 'bk-agent') */
    appName?: string;
  }) {
    this.client = options?.client;
    this.config = options?.config ?? defaultOrchestratorConfig();
    this.customRules = options?.customRules;
    this.capabilityMatrix = options?.capabilityMatrix;
    this.includeDefaultRules = options?.includeDefaultRules ?? true;
    this.reviewAgents = { ...DEFAULT_REVIEW_AGENTS, ...options?.reviewAgents };
    this.customGateAgents = options?.customGateAgents;
    this.appName = options?.appName ?? 'bk-agent';
    this.fsm = new TaskFSM();
    this.auditReporter = new AuditReporter({
      projectRoot: options?.projectRoot ?? process.cwd(),
      useGlobalDir: true,
      appName: this.appName,
    });
  }

  /**
   * @description Procesa el input del usuario a través del pipeline completo.
   * 
   * @param input - Texto del usuario
   * @returns Resultado completo de la orquestación
   */
  async orchestrate(input: string): Promise<OrchestrationResult> {
    const enrichResult = await pipeline<OrchestratorCtx, Error>()
      .pipeIf(_ => this.config.features.intentDetection, new IntentStep(this.client))
      .pipeIf(_ => this.config.features.domainDetection, new DomainStep())
      .pipeIf(_ => this.config.features.riskScoring, new RiskStep(this.config))
      .pipeIf(_ => this.config.features.policyEngine, new PolicyStep(
        this.customRules,
        () => this.loadManifestPolicyRules(),
        input,
        this.includeDefaultRules,
      ))
      .run({ task: createTaskContext(input), policyResult: EMPTY_POLICY_RESULT });

    if (!enrichResult.ok) {
      throw enrichResult.error.cause;
    }

    const { task, policyResult } = enrichResult.value;

    const selectedAgents = this.selectAgents(task, policyResult);
    const gateResolution = resolveGates(
      task, policyResult, this.config, selectedAgents,
      this.reviewAgents, this.customGateAgents,
    );
    const agentPipeline = gateResolution.pipeline.length > 0 ? gateResolution.pipeline : undefined;
    const commitAllowed = gateResolution.commitAllowed;

    // Nombres de customGates pendientes, aparte de los 3 built-in (que ya vienen en
    // policyResult.requiredGates) — se preserva el valor exacto de policyResult.requiredGates
    // para no cambiar comportamiento existente de agent-coding.
    const pendingCustomGateNames = Object.entries(task.customGates)
      .filter(([name, required]) => required && !task.completedCustomGates.includes(name))
      .map(([name]) => name);

    await this.recordOrchestrationGate(task, selectedAgents, policyResult);

    return {
      task,
      selectedAgents,
      agentPipeline,
      appliedPolicies: policyResult.appliedRules.map(r => ({ rule: r.rule, reason: r.reason })),
      requiredGates: [...policyResult.requiredGates, ...pendingCustomGateNames],
      commitAllowed,
    };
  }

  // ── Auditoría ──────────────────────────────────────────────────────────

  /**
   * @description Obtiene la instancia del AuditReporter para registrar gates
   * desde el AgentLoop u otros componentes.
   */
  getAuditReporter(): AuditReporter {
    return this.auditReporter;
  }

  /**
   * @description Intenta transicionar el estado de la tarea en el FSM.
   * Expuesto para que el QA orchestrator pueda avanzar estados desde el loop.
   */
  transitionTask(task: TaskContext, to: TaskStatus): FSMTransitionResult {
    return this.fsm.transition(task, to);
  }

  /**
   * @description Registra automáticamente un gate de orquestación después
   * de ejecutar el pipeline completo.
   */
  private async recordOrchestrationGate(
    task: TaskContext,
    selectedAgents: Array<{ agentId: string; score: number; reason: string }>,
    policyResult: PolicyEngineResult
  ): Promise<void> {
    const hallazgos: AuditFinding[] = [];

    // Hallazgo de riesgos
    if (task.riskLevel === 'high' || task.riskLevel === 'critical') {
      hallazgos.push({
        id: `ORQ-${randomUUID().slice(0, 8)}`,
        dimension: 'Riesgo',
        hallazgo: `Tarea con nivel de riesgo ${task.riskLevel}`,
        severidad: task.riskLevel === 'critical' ? 'critical' : 'high',
        evidencia: `RiskLevel: ${task.riskLevel}, Factores: ${JSON.stringify(task.riskFactors)}`,
        recomendacion: 'Asegurar que todos los gates requeridos se ejecuten antes del commit',
        agenteResponsable: 'orchestrator',
      });
    }

    // Hallazgo de gates requeridos
    if (policyResult.requiredGates.length > 0) {
      hallazgos.push({
        id: `GATES-${randomUUID().slice(0, 8)}`,
        dimension: 'Políticas',
        hallazgo: `Gates requeridos: ${policyResult.requiredGates.join(', ')}`,
        severidad: 'medium',
        evidencia: `Reglas aplicadas: ${policyResult.appliedRules.map(r => r.rule).join(', ')}`,
        recomendacion: `Ejecutar gates: ${policyResult.requiredGates.join(', ')} antes del commit`,
        agenteResponsable: 'orchestrator',
      });
    }

    // Hallazgo de agentes seleccionados
    if (selectedAgents.length > 0) {
      hallazgos.push({
        id: `AGENTS-${randomUUID().slice(0, 8)}`,
        dimension: 'Selección de Agentes',
        hallazgo: `Agentes seleccionados: ${selectedAgents.map(a => a.agentId).join(', ')}`,
        severidad: 'low',
        evidencia: `Top: ${selectedAgents[0]?.agentId} (score: ${selectedAgents[0]?.score})`,
        recomendacion: selectedAgents.length === 1 && selectedAgents[0]?.agentId === 'general'
          ? 'Considerar configurar capability matrix para mejor selección'
          : 'Selección automática correcta',
        agenteResponsable: 'orchestrator',
      });
    }

    const veredicto: GateVeredict =
      task.riskLevel === 'critical' ? 'NO-GO condicional' :
      task.riskLevel === 'high' ? 'NO-GO condicional' :
      'GO';

    await this.auditReporter.recordGate(
      'orquestación',
      'orchestrator',
      veredicto,
      hallazgos,
      task,
      `Pipeline ejecutado: intent → domains → risk → policies → agents → gates`,
      true // skipIfEmpty: No persistir auto-gates sin hallazgos (reduce ruido)
    );
  }

  // ── Selección de Agentes ────────────────────────────────────────────────

  /**
   * Selecciona agentes combinando:
   * - Políticas obligatorias (mustInclude)
   * - Capability matrix (dominios)
   * - Pesos dinámicos
   */
  private selectAgents(
    task: TaskContext,
    policyResult: PolicyEngineResult
  ): Array<{ agentId: string; score: number; reason: string }> {
    const selected: Array<{ agentId: string; score: number; reason: string }> = [];
    const seen = new Set<string>();

    // Fuente única de verdad: task.assignedAgents (ya rellenado por applyPolicies)
    // más cualquier mustInclude adicional que la política reportó
    const mandatoryIds = new Set([
      ...task.assignedAgents,
      ...policyResult.mustInclude,
    ]);

    for (const agentId of mandatoryIds) {
      if (!seen.has(agentId)) {
        seen.add(agentId);
        selected.push({ agentId, score: 100, reason: 'Politica obligatoria' });
      }
    }

    // Agentes por capability matrix (dominios detectados)
    if (this.capabilityMatrix) {
      for (const domain of task.domains) {
        for (const [agentId, capability] of Object.entries(this.capabilityMatrix)) {
          if (seen.has(agentId)) continue;
          if (capability.owns.includes(domain)) {
            seen.add(agentId);
            const baseWeight = capability.baseWeight ?? 0.8;
            selected.push({
              agentId,
              score: Math.round(baseWeight * 100),
              reason: `Domina el dominio: ${domain}`,
            });
          }
        }
      }
    }

    // Agente general como fallback
    if (selected.length === 0) {
      selected.push({ agentId: 'general', score: 50, reason: 'Fallback: agente general' });
    }

    return selected.sort((a, b) => b.score - a.score);
  }

  // Nota: el pipeline de agentes (review → implement → verify) y la resolución de
  // commitAllowed viven en gate-resolver.ts (resolveGates/resolveCommitAllowed) —
  // única fuente de verdad, invocada desde orchestrate(). No duplicar acá.

  /**
   * @description Obtiene los estados destino válidos desde el estado actual.
   */
  getAvailableTransitions(status: TaskStatus): TaskStatus[] {
    return this.fsm.getAvailableTransitions(status);
  }

  /**
   * @description Calcula la ruta crítica desde el estado actual hasta commit_allowed.
   */
  getCriticalPath(task: TaskContext): TaskStatus[] {
    return this.fsm.getCriticalPath(task);
  }

  /**
   * @description Obtiene la instancia del FSM.
   */
  getFSM(): TaskFSM {
    return this.fsm;
  }

  /**
   * @description Actualiza la configuración en runtime.
   */
  updateConfig(config: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * @description Actualiza las reglas personalizadas en runtime.
   */
  updateRules(rules: PolicyRule[]): void {
    this.customRules = rules;
  }

  /**
   * @description Actualiza la capability matrix en runtime.
   */
  updateCapabilityMatrix(matrix: CapabilityMatrix): void {
    this.capabilityMatrix = matrix;
  }

  /**
   * @description Carga las policyRules auto-promovidas desde manifest.yaml.
   * Estas son generadas por el PolicyPromoter del Reflection Engine y se
   * fusionan con las customRules en cada orchestrate().
   */
  private async loadManifestPolicyRules(): Promise<PolicyRule[]> {
    try {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      const manifestPath = path.join(home, `.${this.appName}`, 'manifest.yaml');
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      const rules: Array<{ if?: unknown; then?: unknown }> = manifest?.policyRules ?? [];
      return rules
        .filter(r => r.if && r.then)
        .map(r => ({ if: r.if, then: r.then })) as PolicyRule[];
    } catch {
      return [];
    }
  }
}
