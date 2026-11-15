/**
 * @description AuditReflectionBridge — Puente entre AuditReporter y ReflectionEngine.
 *
 * Permite conectar/desconectar el sistema de auditoría con el Reflection Engine
 * para auto-aprendizaje. Cuando está conectado, los hallazgos de auditoría se
 * reportan automáticamente al Reflection Engine, que detecta patrones y promueve
 * reglas de policy.
 *
 * @see AuditHook para la implementación concreta del reporte.
 */

import { ReflectionEngine } from '@backendkit-labs/agent-core';
import { AuditHook } from '../../reflection/hooks/audit-hook';
import { LessonsMemoGenerator } from '../../reflection/lessons-memo-generator';
import { GateRecord } from './types';

// ── AuditReflectionBridge ────────────────────────────────────────────────────

export class AuditReflectionBridge {
  private hook: AuditHook | null = null;
  private engine: ReflectionEngine | null = null;

  /**
   * @description Conecta con el Reflection Engine.
   */
  connect(engine: ReflectionEngine): void {
    this.hook = new AuditHook(engine);
    this.engine = engine;
  }

  /**
   * @description Desconecta del Reflection Engine.
   */
  disconnect(): void {
    this.hook = null;
    this.engine = null;
  }

  /**
   * @description Indica si está conectado.
   */
  get isConnected(): boolean {
    return this.hook !== null;
  }

  /**
   * @description Reporta los hallazgos al Reflection Engine, detecta patrones,
   * promueve PolicyRules y actualiza lecciones-aprendidas.md.
   *
   * Pipeline completo (solo si hay findings con hallazgos):
   *   1. AuditHook.reportFindings() → agrega FailureRecords al catálogo
   *   2. engine.flushReflections()  → detecta patrones y promueve a PolicyRules
   *   3. LessonsMemoGenerator.persist() → actualiza lecciones-aprendidas.md
   */
  async reportFindings(gates: GateRecord[]): Promise<void> {
    if (!this.hook || !this.engine) return;

    const gatesWithFindings = gates.filter(g => g.hallazgos.length > 0);
    if (gatesWithFindings.length === 0) return;

    for (const gate of gatesWithFindings) {
      await this.hook.reportFindings(gate.hallazgos, gate.gate, 'audit');
    }

    // Detectar patrones cross-sprint y auto-promover PolicyRules
    await this.engine.flushReflections();

    // Sobreescribir lecciones-aprendidas.md con datos históricos acumulados
    await new LessonsMemoGenerator(this.engine).persist().catch(() => {});
  }
}
