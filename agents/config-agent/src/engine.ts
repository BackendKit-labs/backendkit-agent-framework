/**
 * Engine mínimo para config-agent.
 *
 * Este engine recibe tareas con { tool, args } y las delega al tool registry.
 * Es funcional pero mínimo — en una implementación completa se expandiría para:
 *   - Manejar ciclo de vida del agente (init, shutdown)
 *   - Soportar middlewares (logging, rate limiting, auth)
 *   - Ejecutar tools en paralelo con control de concurrencia
 *   - Emitir eventos de progreso vía CallbackTransport
 */

import { CallbackTransport } from '@backendkit-labs/agent-core';
import { tools } from './tools.js';
import { auditLogger } from './audit.js';

export function createEngine(transport: CallbackTransport) {
  return {
    /**
     * Procesa un task ejecutando la tool correspondiente.
     * @param task Objeto con { tool: string, args: Record<string, any> }
     * @returns Resultado de la tool como string JSON
     */
    async processTask(task: { tool: string; args: Record<string, any> }): Promise<string> {
      const toolDef = tools.find(t => t.name === task.tool);

      if (!toolDef) {
        const available = tools.map(t => t.name).join(', ');
        throw new Error(
          `Tool '${task.tool}' no encontrada. Tools disponibles: ${available}`
        );
      }

      const start = Date.now();
      try {
          const result = await toolDef.execute(task.args, {} as any);
          auditLogger.write({
              tool: task.tool, status: 'ok', durationMs: Date.now() - start,
              agentId: typeof task.args['agent_id'] === 'string' ? task.args['agent_id'] : undefined,
          });
          return result;
      } catch (err) {
          auditLogger.write({
              tool: task.tool, status: 'error', durationMs: Date.now() - start,
              agentId: typeof task.args['agent_id'] === 'string' ? task.args['agent_id'] : undefined,
              error: (err as Error).message,
          });
          throw err;
      }
    },
  };
}
