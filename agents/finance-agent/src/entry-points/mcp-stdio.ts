import { ToolRegistry } from '../core/tool-registry';
import { registerNativeTools } from '../tools';
import { createInterface } from 'readline';
import { MCPBridge, type MCPServerConfig } from '../core/mcp-bridge';
import { loadConfig } from '../config/loader';

export interface JsonRpcRequest {
  jsonrpc: string;
  id: unknown;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Implementa el protocolo JSON-RPC 2.0 del servidor MCP sobre tools nativas.
 * Extraído como clase pura (sin stdin/stdout) para poder testearse directamente;
 * `createMCPServerStdio()` la usa para el modo stdio real.
 */
export class MCPServer {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry = new ToolRegistry()) {
    this.registry = registry;
    registerNativeTools((tool) => this.registry.registerNativeTool(tool));
  }

  /**
   * Conecta los servidores MCP configurados (ej. el ERP de la empresa vía
   * config.mcp_servers) y registra sus tools en el mismo registry que las
   * nativas, así quedan disponibles para tools/list y tools/call sin
   * distinción para quien consuma este servidor stdio.
   */
  async connectMCPServers(configs: MCPServerConfig[]): Promise<void> {
    if (configs.length === 0) return;
    const bridge = new MCPBridge(this.registry);
    this.registry.setMCPExecutor(bridge.createExecutor());
    const results = await bridge.discoverAndRegisterAll(configs);
    for (const result of results) {
      if (!result.success) {
        process.stderr.write(
          `[finance-agent] No se pudo conectar al servidor MCP "${result.serverName}": ${result.error}\n`,
        );
      }
    }
  }

  /** Parsea y valida un mensaje JSON-RPC. Lanza si no es JSON válido o no es jsonrpc 2.0. */
  parseRequest(line: string): JsonRpcRequest {
    const request = JSON.parse(line) as JsonRpcRequest;
    if (request.jsonrpc !== '2.0') {
      throw new Error('Invalid Request: se esperaba jsonrpc 2.0');
    }
    return request;
  }

  /** Procesa un mensaje JSON-RPC completo y devuelve la respuesta serializada. */
  async handleRequest(line: string): Promise<string> {
    let request: JsonRpcRequest;
    try {
      request = this.parseRequest(line);
    } catch (error) {
      return this.serializeError(null, -32700, `Parse error: ${(error as Error).message}`);
    }

    switch (request.method) {
      case 'initialize':
        return this.serializeResponse(request.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'finance-agent', version: '1.0.0' },
        });

      case 'tools/list':
        return this.serializeResponse(request.id, { tools: this.registry.listTools() });

      case 'tools/call': {
        const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) {
          return this.serializeError(request.id, -32602, 'Invalid params: se requiere "name"');
        }
        const result = await this.registry.executeTool(params.name, params.arguments ?? {});
        if (!result.success && result.error === `Tool no encontrada: ${params.name}`) {
          return this.serializeError(request.id, -32602, result.error);
        }
        // El resultado de tools/call en MCP real es {content: [{type,text}], isError?}
        // — no un objeto arbitrario. Sin esto, cualquier cliente MCP que valide
        // contra CallToolResultSchema (ej. el SDK oficial) rechaza la respuesta.
        return this.serializeResponse(request.id, {
          content: [{ type: 'text', text: JSON.stringify(result.success ? result.data : result.error) }],
          isError: !result.success,
        });
      }

      default:
        return this.serializeError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private serializeResponse(id: unknown, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
  }

  private serializeError(id: unknown, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

/**
 * Crea y configura el servidor MCP sobre stdio.
 * Lee mensajes JSON-RPC desde stdin y escribe respuestas a stdout.
 *
 * Si FINANCE_CONFIG_PATH apunta a un config.yaml de empresa válido, conecta
 * también los mcp_servers ahí declarados (ej. el ERP real de esa empresa)
 * antes de empezar a aceptar requests.
 */
export async function createMCPServerStdio(): Promise<void> {
  const server = new MCPServer();

  const configPath = process.env.FINANCE_CONFIG_PATH;
  if (configPath) {
    try {
      const config = loadConfig(configPath);
      // config.mcp_servers usa el schema de config/schema.ts (api_key, sin
      // timeoutMs) — MCPBridge usa su propio schema (apiKey, timeoutMs
      // requerido con default). Se mapea acá en vez de unificar ambos
      // schemas, que evolucionaron por separado para propósitos distintos.
      const mcpConfigs: MCPServerConfig[] = config.mcp_servers.map((s) => ({
        name: s.name,
        transport: s.transport,
        command: s.command,
        args: s.args ?? [],
        env: s.env ?? {},
        url: s.url,
        apiKey: s.api_key,
        timeoutMs: 15000,
      }));
      await server.connectMCPServers(mcpConfigs);
    } catch (error) {
      process.stderr.write(
        `[finance-agent] No se pudo cargar config desde FINANCE_CONFIG_PATH="${configPath}": ${(error as Error).message}\n`,
      );
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    const response = await server.handleRequest(line);
    process.stdout.write(response + '\n');
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Iniciar servidor si se ejecuta directamente
if (require.main === module) {
  createMCPServerStdio().catch((error) => {
    process.stderr.write(`[finance-agent] Error fatal al iniciar el servidor stdio: ${error}\n`);
    process.exit(1);
  });
}
