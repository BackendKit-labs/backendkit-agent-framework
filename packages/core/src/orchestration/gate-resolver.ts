/**
 * @description GateResolver — Única fuente de verdad para la resolución de gates.
 *
 * Consolida la lógica que estaba dispersa en:
 * - buildPipeline() de orchestrator/index.ts
 * - isCommitAllowed() de orchestrator/index.ts
 * - policy-engine.ts (requiredGates)
 * - risk-scorer.ts (riskLevel → gates)
 *
 * Usar esta función como punto de entrada canónico para determinar:
 * qué agentes se activan en cada fase, y si el commit está permitido.
 */

import { TaskContext } from './task-context';
import { PolicyEngineResult } from './policy-engine';
import { AgentPipelinePhase } from './types';
import { OrchestratorConfig } from './types';

export interface GateResolution {
  /** Pipeline de fases de agentes a ejecutar */
  pipeline: AgentPipelinePhase[];
  /** Si el commit está permitido en el estado actual */
  commitAllowed: boolean;
  /** Reviews obligatorias detectadas (para trazabilidad) — incluye nombres de customGates */
  requiredReviews: string[];
}

/** Agent IDs para las fases review/verify. Default: roster de agent-coding. */
export interface GateReviewAgentIds {
  security?: string;
  architecture?: string;
  qa?: string;
}

/**
 * @description Determina el pipeline de gates y si el commit está permitido.
 *
 * @param task - Contexto de la tarea orquestada
 * @param policyResult - Resultado del PolicyEngine con gates requeridos
 * @param config - Configuración del orquestador
 * @param selectedAgents - Agentes ya seleccionados por el router
 * @param reviewAgents - Agent IDs para security/architecture/qa. Default: agent-coding
 *   ('security'/'architecture'/'qa-engineer'). Verticales sin esos agentes pasan los suyos.
 * @param customGateAgents - Mapa nombre-de-gate → agentId para los customGates de task.
 *   Si un gate no tiene entrada acá, se usa su propio nombre como agentId.
 */
export function resolveGates(
  task: TaskContext,
  policyResult: PolicyEngineResult,
  config: OrchestratorConfig,
  selectedAgents: Array<{ agentId: string; score: number; reason: string }>,
  reviewAgents?: GateReviewAgentIds,
  customGateAgents?: Record<string, string>,
): GateResolution {
  const pipeline: AgentPipelinePhase[] = [];
  const requiredReviews: string[] = [];
  const securityAgentId     = reviewAgents?.security ?? 'security';
  const architectureAgentId = reviewAgents?.architecture ?? 'architecture';
  const qaAgentId           = reviewAgents?.qa ?? 'qa-engineer';

  const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'critical';
  const hasSecurityDomain = task.domains.includes('security');
  const hasArchitectureDomain =
    task.domains.includes('architecture') || task.domains.includes('resilience');

  // Review de seguridad
  if (task.requiresSecurityReview || (isHighRisk && hasSecurityDomain)) {
    pipeline.push({
      phase: 'review',
      agentId: securityAgentId,
      purpose: 'Review security implications',
      optional: false,
    });
    requiredReviews.push('security');
  }

  // Review de arquitectura
  if (task.requiresArchitectureReview || (isHighRisk && hasArchitectureDomain)) {
    pipeline.push({
      phase: 'review',
      agentId: architectureAgentId,
      purpose: 'Review architecture for high-risk change',
      optional: false,
    });
    requiredReviews.push('architecture');
  }

  // Reviews de gates con nombre abierto (ej. 'compliance' para un vertical de finance).
  // No tienen orden ni estado propio en la FSM — se satisfacen marcando su nombre en
  // task.completedCustomGates, típicamente desde fuera del flujo LLM (aprobación humana,
  // webhook de negocio), igual que el gate_criteria de orchestrator-agent.
  for (const [gateName, required] of Object.entries(task.customGates)) {
    if (!required || task.completedCustomGates.includes(gateName)) continue;
    pipeline.push({
      phase: 'review',
      agentId: customGateAgents?.[gateName] ?? gateName,
      purpose: `Custom review: ${gateName}`,
      optional: false,
    });
    requiredReviews.push(gateName);
  }

  // Fase de implementación: mejor agente seleccionado
  const topAgent = selectedAgents[0];
  if (topAgent && topAgent.agentId !== 'general') {
    pipeline.push({
      phase: 'implement',
      agentId: topAgent.agentId,
      purpose: topAgent.reason,
      optional: false,
    });
  }

  // Fase de verificación QA
  const hasImplementPhase = pipeline.some(p => p.phase === 'implement');
  if (hasImplementPhase && task.requiresQaApproval) {
    pipeline.push({
      phase: 'verify',
      agentId: qaAgentId,
      purpose: 'Verify implementation quality and best practices',
      optional: false,
    });
    requiredReviews.push('qa');
  }

  const commitAllowed = resolveCommitAllowed(task, policyResult, config);

  return { pipeline, commitAllowed, requiredReviews };
}

/**
 * @description Determina si el commit está permitido según el estado del task y las políticas.
 */
export function resolveCommitAllowed(
  task: TaskContext,
  policyResult: PolicyEngineResult,
  config: OrchestratorConfig
): boolean {
  if (!config.features.commitGate) return true;
  if (task.status === 'commit_allowed') return true;

  if (task.requiresQaApproval && task.status !== 'approved' && task.status !== 'qa_review') return false;
  if (task.requiresSecurityReview && task.status !== 'approved' && task.status !== 'security_review') return false;
  if (task.requiresArchitectureReview && task.status !== 'approved' && task.status !== 'design_review') return false;

  const pendingCustomGates = Object.entries(task.customGates)
    .some(([name, required]) => required && !task.completedCustomGates.includes(name));
  if (pendingCustomGates) return false;

  if (!task.requiresQaApproval && !task.requiresSecurityReview && !task.requiresArchitectureReview) {
    return true;
  }

  return false;
}
