// ---------------------------------------------------------------------------
// Engine — Registry pattern + handlers + engine factory
// ---------------------------------------------------------------------------

import { CallbackTransport } from '@backendkit-labs/agent-core';
import { getCached, setCache } from './cache.js';
import { auditLogger } from './audit.js';
import { collectEnvironment } from './checks/environment.js';
import { pingOrchestrator, listAgents, listRuns, pingAgent } from './checks/orchestrator.js';
import { checkMessaging } from './checks/messaging.js';
import { checkScheduler } from './checks/scheduler.js';
import { checkVault } from './checks/vault.js';
import { runEndToEndTest } from './checks/e2e.js';
import type { EnvironmentCheck, HealthReport } from './types.js';

// ---------------------------------------------------------------------------
// Tool handler registry
// ---------------------------------------------------------------------------

type ToolHandler = (prompt: string) => Promise<string>;

const toolHandlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  toolHandlers.set(name, handler);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

registerTool('system_health', async () => {
  // Ejecutar todos los checks en paralelo
  const [orchResult, agentsResult, runsResult, envResult, msgResult, schedResult, vaultResult] = await Promise.all([
    pingOrchestrator(),
    listAgents(),
    listRuns(),
    (async () => {
      const envHandler = toolHandlers.get('check_environment');
      return envHandler ? JSON.parse(await envHandler('check_environment')) : {};
    })(),
    checkMessaging(),
    checkScheduler(),
    checkVault(),
  ]);

  const report: HealthReport = {
    status: orchResult.status === 'up' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      orchestrator: orchResult,
      agents: agentsResult,
      flows: runsResult,
      scheduler: schedResult,
      environment: envResult,
      messaging: msgResult,
      vault: vaultResult,
    },
    summary: `Health check - Orquestador: ${orchResult.status}, Agentes: ${agentsResult.alive}/${agentsResult.total}, Flows: ${runsResult.active_runs}, Scheduler: ${schedResult.tasks_scheduled} tasks, Vault: ${vaultResult.notes} notas`,
    recommended_actions: orchResult.status === 'down' ? ['Verificar que el orquestador esté corriendo en ORCHESTRATOR_URL'] : [],
  };

  return JSON.stringify(report);
});

registerTool('check_agent', async (prompt) => {
  const agentMatch = prompt.match(/agente: (\w+)/);
  const agentId = agentMatch?.[1] || 'unknown';
  const result = await pingAgent(agentId);
  return JSON.stringify(result);
});

registerTool('check_environment', async () => {
  const cached = getCached<EnvironmentCheck>('environment');
  if (cached) return JSON.stringify(cached);

  const checks = collectEnvironment();
  setCache('environment', checks);

  return JSON.stringify(checks);
});

registerTool('check_messaging', async () => {
  return JSON.stringify(await checkMessaging());
});

registerTool('check_scheduler', async () => {
  return JSON.stringify(await checkScheduler());
});

registerTool('check_vault', async () => {
  return JSON.stringify(await checkVault());
});

registerTool('end_to_end_test', async (prompt) => {
  const flowMatch = prompt.match(/flow: (\S+)/);
  const flowId = flowMatch?.[1];
  const result = await runEndToEndTest(flowId);
  return JSON.stringify(result);
});

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

export function createEngine(transport: CallbackTransport) {
  return {
    run: async (prompt: string): Promise<void> => {
      try {
        for (const [name, handler] of toolHandlers) {
          if (prompt.includes(name)) {
            const start = Date.now();
            try {
              const result = await handler(prompt);
              const parsed = JSON.parse(result) as Record<string, unknown>;
              auditLogger.write({
                tool: name, status: 'ok', durationMs: Date.now() - start,
                extra: name === 'system_health' ? { healthStatus: parsed['status'] } : undefined,
              });
              transport.emit({ type: 'token', content: result });
              transport.emit({ type: 'done' });
            } catch (handlerErr) {
              auditLogger.write({ tool: name, status: 'error', durationMs: Date.now() - start, error: String(handlerErr) });
              throw handlerErr;
            }
            return;
          }
        }

        transport.emit({
          type: 'token',
          content: JSON.stringify({ error: 'Unknown tool' }),
        });
        transport.emit({ type: 'done' });
      } catch (err) {
        transport.emit({
          type: 'error',
          message: `Engine error: ${String(err)}`,
        });
      }
    },
  };
}
