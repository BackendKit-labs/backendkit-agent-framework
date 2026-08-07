import { createBaseEngine, StdoutTransport } from '@backendkit-labs/agent-core';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';
import { z } from 'zod';
import { ApiGatewayClient } from '../api-gateway/client';
import { SchedulerClient } from './scheduler-client';
import { NotifierClient } from './notifier-client';
import { ToolRegistry } from './tool-registry';

// ──────────────────────────────────────────────
// Schema de configuración
// ──────────────────────────────────────────────

/**
 * Schema de configuración del engine.
 * Valida que los parámetros esenciales estén presentes antes de crear el agente.
 */
const EngineConfigSchema = z.object({
  provider: z.literal('deepseek'),
  model: z.string().default('deepseek-chat'),
  vaultPath: z.string().default('~/.backendkit/vaults/finance-agent'),
  apiKey: z.string().min(1, 'API key de DeepSeek es requerida'),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().positive().default(4096),
});

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────

export interface EngineConfig {
  apiKey?: string;
  vaultPath?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface Engine {
  complete: (prompt: string) => Promise<string>;
}

// ──────────────────────────────────────────────
// DeepSeek LLM Provider
// ──────────────────────────────────────────────

/**
 * Implementación de LLMProvider para DeepSeek.
 * Se comunica con la API de DeepSeek vía fetch.
 */
class DeepSeekProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(opts: {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
  }

  async chat(
    messages: LLMMessage[],
    _tools: ToolDefinition[],
    callbacks: LLMStreamCallbacks
  ): Promise<void> {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: callbacks.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `DeepSeek API error: HTTP ${response.status} — ${errorBody}`
        );
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string | null };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
        };
      };

      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('DeepSeek API returned no choices');
      }

      const content = choice.message.content ?? '';

      // Emitir chunks para compatibilidad con streaming
      callbacks.onChunk?.(content);

      // Reportar métricas si están disponibles
      if (data.usage) {
        callbacks.onMetrics?.(data.usage.prompt_tokens, data.usage.completion_tokens);
      }

      callbacks.onDone({
        role: 'assistant',
        content,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
    }
  }
}

// ──────────────────────────────────────────────
// Factory function
// ──────────────────────────────────────────────

/**
 * Crea y retorna una instancia del engine del agente financiero.
 *
 * @param config - Configuración parcial que se fusiona con defaults.
 * @returns Una instancia de agente lista para usar.
 * @throws Si la configuración es inválida o faltan campos requeridos.
 */
export function createEngine(config: EngineConfig = {}): Engine {
  // 1. Fusionar config provista con defaults
  const merged = {
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    vaultPath: '~/.backendkit/vaults/finance-agent',
    apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '',
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 4096,
  };

  // 2. Validar con Zod
  const parsed = EngineConfigSchema.parse(merged);

  // 3. Crear el provider de DeepSeek
  const deepseekProvider = new DeepSeekProvider({
    apiKey: parsed.apiKey,
    model: parsed.model,
    temperature: parsed.temperature,
    maxTokens: parsed.maxTokens,
  });

  // 4. Crear el engine base con el provider
  const agentEngine = createBaseEngine({
    providers: {
      deepseek: deepseekProvider,
    },
    defaultProvider: 'deepseek',
    agents: [],
    tools: [],
    transport: new StdoutTransport(),
    maxIterations: 1,
  });

  // 5. Retornar interfaz Engine que envuelve el AgentEngine
  return {
    complete: async (prompt: string): Promise<string> => {
      return agentEngine.callLLM(prompt);
    },
  };
}

// ──────────────────────────────────────────────
// Engine V2 — Factory con microservicios
// ──────────────────────────────────────────────

/**
 * Crea una instancia del engine con clientes para los microservicios
 * (API Gateway, Scheduler, Notifier) ya configurados.
 *
 * @param configPath - Ruta al archivo de configuración YAML
 * @returns Objeto con toolRegistry, config, vaultPath y clientes de microservicios
 */
export async function createEngineV2(configPath: string) {
  const { loadConfig, resolveVaultPath } = await import('../config/loader');
  const config = loadConfig(configPath);
  const vaultPath = resolveVaultPath(config.company.id);
  const apiGateway = new ApiGatewayClient({ baseUrl: 'http://localhost:4000', apiKey: 'not-configured', timeoutMs: 10000 });
  const scheduler = new SchedulerClient({ baseUrl: 'http://localhost:3100', apiKey: 'not-configured', timeoutMs: 10000 });
  const notifier = new NotifierClient({ baseUrl: 'http://localhost:3002', apiKey: 'not-configured', timeoutMs: 10000 });
  const toolRegistry = new ToolRegistry();
  return { toolRegistry, config, vaultPath, apiGateway, scheduler, notifier };
}
