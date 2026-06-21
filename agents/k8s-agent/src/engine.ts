import {
  AgentEngine,
  AgentRegistry,
  ToolRegistry,
  ProviderRegistry,
  CallbackTransport,
} from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { loadConfig } from './config';
import { K8S_AGENT_PROFILE } from './agents/k8s-agent';
import { k8sApply, k8sGet, k8sDescribe, k8sLogs, k8sExec, k8sDelete } from './tools/k8s';
import { auditLogger } from './audit';
import type { ToolDefinition } from '@backendkit-labs/agent-core';

function withAudit(tool: ToolDefinition): ToolDefinition {
    return {
        ...tool,
        execute: async (args, ctx) => {
            const start = Date.now();
            try {
                const result = await tool.execute(args, ctx);
                auditLogger.write({ tool: tool.name, status: 'ok', durationMs: Date.now() - start });
                return result;
            } catch (err) {
                auditLogger.write({ tool: tool.name, status: 'error', durationMs: Date.now() - start, error: (err as Error).message });
                throw err;
            }
        },
    };
}

export function createK8sEngine(transport: CallbackTransport): AgentEngine {
  const config = loadConfig();

  const tools = new ToolRegistry();
  tools
    .register(withAudit(k8sApply))
    .register(withAudit(k8sGet))
    .register(withAudit(k8sDescribe))
    .register(withAudit(k8sLogs))
    .register(withAudit(k8sExec))
    .register(withAudit(k8sDelete));

  const agents = new AgentRegistry();
  agents.register(K8S_AGENT_PROFILE);

  const providers = new ProviderRegistry();
  providers.register(
    config.llmProvider,
    new OpenAICompatibleProvider({ apiKey: config.llmApiKey, baseUrl: config.llmBaseUrl, model: config.llmModel }),
  );

  return new AgentEngine({
    model: { provider: config.llmProvider, id: config.llmModel, apiKey: config.llmApiKey, baseUrl: config.llmBaseUrl },
    agents,
    tools,
    providers,
    defaultProvider: config.llmProvider,
    defaultAgentId: 'k8s-agent',
    transport,
    maxIterations: 30,
    iterationMode: 'auto',
  });
}
