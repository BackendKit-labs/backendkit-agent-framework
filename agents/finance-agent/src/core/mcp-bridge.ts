import { ChildProcess, spawn } from 'child_process';
import { z } from 'zod';
import { ToolRegistry, type MCPToolDefinition } from './tool-registry';

// ──────────────────────────────────────────────
// Schemas Zod
// ──────────────────────────────────────────────

/**
 * Schema para la configuración de un servidor MCP externo.
 */
export const MCPServerConfigSchema = z.object({
  name: z.string().min(1, 'El nombre del servidor MCP es requerido'),
  transport: z.enum(['stdio', 'http']),
  /** Comando a ejecutar (solo para transporte stdio) */
  command: z.string().optional(),
  /** Argumentos del comando (solo para transporte stdio) */
  args: z.array(z.string()).default([]),
  /** Variables de entorno adicionales (solo para transporte stdio) */
  env: z.record(z.string()).default({}),
  /** URL base del servidor HTTP (solo para transporte http) */
  url: z.string().url().optional(),
  /** API key para autenticación (solo para transporte http) */
  apiKey: z.string().optional(),
  /** Timeout en ms para las operaciones */
  timeoutMs: z.number().positive().default(15000),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

/**
 * Schema para la configuración completa del bridge MCP.
 */
export const MCPBridgeConfigSchema = z.object({
  mcp_servers: z.array(MCPServerConfigSchema).default([]),
});

export type MCPBridgeConfig = z.infer<typeof MCPBridgeConfigSchema>;

// ──────────────────────────────────────────────
// Tipos del protocolo MCP (JSON-RPC 2.0)
// ──────────────────────────────────────────────

/** Esquema de una tool reportada por un servidor MCP vía tools/list */
interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Respuesta del método tools/list */
interface MCPListToolsResult {
  tools: MCPToolSchema[];
}

/** Solicitud JSON-RPC 2.0 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/** Respuesta JSON-RPC 2.0 exitosa */
interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: T;
}

/** Respuesta JSON-RPC 2.0 con error */
interface JSONRPCError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Type guard para JSONRPCResponse */
function isJSONRPCResponse<T>(obj: unknown): obj is JSONRPCResponse<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as Record<string, unknown>).jsonrpc === '2.0' &&
    'result' in (obj as Record<string, unknown>)
  );
}

/** Type guard para JSONRPCError */
function isJSONRPCError(obj: unknown): obj is JSONRPCError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as Record<string, unknown>).jsonrpc === '2.0' &&
    'error' in (obj as Record<string, unknown>)
  );
}

// ──────────────────────────────────────────────
// MCPClient
// ──────────────────────────────────────────────

/**
 * Cliente para conectarse a un servidor MCP externo.
 * Soporta transporte stdio (proceso hijo) y HTTP.
 */
export class MCPClient {
  public readonly config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();
  private requestIdCounter = 0;
  private buffer = '';
  private connected = false;

  constructor(config: MCPServerConfig) {
    const parsed = MCPServerConfigSchema.parse(config);
    this.config = parsed;
  }

  /**
   * Conecta al servidor MCP.
   * - Para transporte stdio: spawn del proceso hijo.
   * - Para transporte http: verifica conectividad.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.config.transport === 'stdio') {
      await this.connectStdio();
    } else {
      await this.connectHttp();
    }

    this.connected = true;
  }

  /**
   * Desconecta del servidor MCP.
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    // Rechazar todas las solicitudes pendientes
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Cliente MCP desconectado'));
      this.pendingRequests.delete(id);
    }

    this.connected = false;
    this.buffer = '';
  }

  /**
   * Obtiene el listado de tools disponibles en el servidor MCP.
   * Llama al método `tools/list` del protocolo MCP.
   */
  async listTools(): Promise<MCPToolSchema[]> {
    const result = await this.sendRequest<MCPListToolsResult>('tools/list');
    return result.tools;
  }

  /**
   * Llama al método `tools/call` del protocolo MCP con el nombre ORIGINAL
   * de la tool (sin el prefijo "{serverId}__" que le agrega discoverTools()).
   *
   * El resultado MCP estándar viene envuelto en `{content: [{type:'text',
   * text: '...'}]}` — se desempaqueta y parsea el JSON para que el llamador
   * reciba el mismo tipo de objeto plano que devuelven las tools nativas.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest<{ content?: Array<{ type: string; text?: string }> }>(
      'tools/call',
      { name: toolName, arguments: args },
    );
    const first = result?.content?.[0];
    if (first && first.type === 'text' && typeof first.text === 'string') {
      try {
        return JSON.parse(first.text);
      } catch {
        return first.text;
      }
    }
    return result;
  }

  /**
   * Convierte las tools descubiertas en definiciones MCPToolDefinition
   * listas para registrar en el ToolRegistry.
   */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    const tools = await this.listTools();

    return tools.map((tool) => ({
      name: `${this.config.name}__${tool.name}`,
      description: tool.description ?? `Tool del servidor MCP "${this.config.name}"`,
      inputSchema: tool.inputSchema ?? {},
      serverId: this.config.name,
      version: '1.0.0',
      tags: ['mcp', this.config.name],
    }));
  }

  /**
   * Envía una solicitud JSON-RPC 2.0 al servidor MCP.
   */
  private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestIdCounter;

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    if (this.config.transport === 'stdio') {
      return this.sendStdioRequest<T>(id, request);
    } else {
      return this.sendHttpRequest<T>(request);
    }
  }

  /**
   * Envía una solicitud por transporte stdio.
   */
  private sendStdioRequest<T>(
    id: number,
    request: JSONRPCRequest
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Timeout en solicitud MCP "${this.config.name}": ${request.method}`
          )
        );
      }, this.config.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      if (this.process?.stdin?.writable) {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`stdin no disponible en servidor "${this.config.name}"`));
      }
    });
  }

  /**
   * Envía una solicitud por transporte HTTP.
   */
  private async sendHttpRequest<T>(request: JSONRPCRequest): Promise<T> {
    const url = this.config.url;
    if (!url) {
      throw new Error(
        `URL no configurada para servidor MCP HTTP "${this.config.name}"`
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} en servidor MCP "${this.config.name}": ${response.statusText}`
        );
      }

      const data: unknown = await response.json();

      if (isJSONRPCError(data)) {
        throw new Error(
          `Error MCP en servidor "${this.config.name}": [${data.error.code}] ${data.error.message}`
        );
      }

      return (data as JSONRPCResponse<T>).result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Conecta por transporte stdio: spawn del proceso hijo.
   */
  private async connectStdio(): Promise<void> {
    const { command, args, env } = this.config;

    if (!command) {
      throw new Error(
        `Comando no especificado para servidor MCP stdio "${this.config.name}"`
      );
    }

    this.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = this.process;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[MCP:${this.config.name}] stderr:`, chunk.toString().trim());
    });

    // Esperar a que el proceso esté listo, o rechazar si falla al arrancar o
    // termina antes de emitir el primer dato (comando inexistente, crash
    // inmediato, etc.) — sin esto connect() resolvía "exitosamente" incluso
    // cuando el proceso nunca llegó a arrancar.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(safetyTimer);
        child.stdout?.off('data', onReady);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const onExit = (code: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `Proceso MCP "${this.config.name}" terminó antes de estar listo (código ${code})`
          )
        );
      };
      const safetyTimer = setTimeout(onReady, 2000);
      child.stdout?.once('data', onReady);
      child.once('error', onError);
      child.once('exit', onExit);
    });

    // Handlers persistentes una vez que la conexión inicial fue exitosa.
    child.on('error', (err) => {
      console.error(`[MCP:${this.config.name}] Error en proceso:`, err.message);
      this.disconnect();
    });

    child.on('exit', (code) => {
      console.error(`[MCP:${this.config.name}] Proceso terminado con código ${code}`);
      this.disconnect();
    });
  }

  /**
   * Conecta por transporte HTTP: verifica conectividad.
   */
  private async connectHttp(): Promise<void> {
    const url = this.config.url;
    if (!url) {
      throw new Error(
        `URL no configurada para servidor MCP HTTP "${this.config.name}"`
      );
    }

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `No se pudo conectar al servidor MCP HTTP "${this.config.name}": HTTP ${response.status}`
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Procesa el buffer de stdout línea por línea (formato JSON-RPC).
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Dejar la última línea incompleta en el buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: unknown = JSON.parse(trimmed);

        if (!isJSONRPCResponse(response) && !isJSONRPCError(response)) {
          console.warn(
            `[MCP:${this.config.name}] Formato JSON-RPC inválido: ${trimmed}`
          );
          continue;
        }

        const id = response.id;
        // Ignorar respuestas sin id (notificaciones)
        if (id === null || id === undefined) continue;

        const pending = this.pendingRequests.get(id);
        if (!pending) {
          console.warn(
            `[MCP:${this.config.name}] Respuesta para solicitud desconocida: ${id}`
          );
          continue;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);

        if (isJSONRPCError(response)) {
          pending.reject(
            new Error(
              `Error MCP en servidor "${this.config.name}": [${response.error.code}] ${response.error.message}`
            )
          );
        } else {
          pending.resolve(response.result);
        }
      } catch {
        console.warn(
          `[MCP:${this.config.name}] Línea no parseable como JSON-RPC: ${trimmed}`
        );
      }
    }
  }
}

// ──────────────────────────────────────────────
// MCPBridge
// ──────────────────────────────────────────────

/**
 * Resultado del descubrimiento de un servidor MCP.
 */
export interface MCPDiscoveryResult {
  serverName: string;
  success: boolean;
  toolsDiscovered: number;
  toolsRegistered: number;
  error?: string;
}

/**
 * Bridge que descubre y registra tools de servidores MCP externos.
 *
 * Flujo:
 * 1. Recibe una lista de configuraciones de servidores MCP
 * 2. Para cada servidor, crea un MCPClient y se conecta
 * 3. Llama a tools/list para descubrir las tools disponibles
 * 4. Registra cada tool en el ToolRegistry con prefijo {serverName}__
 */
export class MCPBridge {
  private clients: Map<string, MCPClient> = new Map();
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Descubre y registra tools de todos los servidores MCP configurados.
   *
   * @param configs - Lista de configuraciones de servidores MCP
   * @returns Array con los resultados de cada servidor
   */
  async discoverAndRegisterAll(
    configs: MCPServerConfig[]
  ): Promise<MCPDiscoveryResult[]> {
    const results: MCPDiscoveryResult[] = [];

    for (const config of configs) {
      const result = await this.discoverAndRegister(config);
      results.push(result);
    }

    return results;
  }

  /**
   * Descubre y registra tools de un único servidor MCP.
   */
  async discoverAndRegister(config: MCPServerConfig): Promise<MCPDiscoveryResult> {
    const client = new MCPClient(config);
    this.clients.set(config.name, client);

    try {
      await client.connect();
      const tools = await client.discoverTools();

      let toolsRegistered = 0;
      for (const tool of tools) {
        try {
          this.registry.registerMCPTool(tool);
          toolsRegistered++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error desconocido';
          console.warn(
            `[MCPBridge] No se pudo registrar tool "${tool.name}": ${message}`
          );
        }
      }

      return {
        serverName: config.name,
        success: true,
        toolsDiscovered: tools.length,
        toolsRegistered,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      console.error(
        `[MCPBridge] Error al conectar con servidor "${config.name}": ${message}`
      );

      return {
        serverName: config.name,
        success: false,
        toolsDiscovered: 0,
        toolsRegistered: 0,
        error: message,
      };
    }
  }

  /**
   * Obtiene un cliente MCP por nombre de servidor.
   */
  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Crea un MCPToolExecutor listo para pasarle a
   * ToolRegistry.setMCPExecutor() — resuelve el cliente correcto por
   * serverId y reenvía la llamada.
   */
  createExecutor(): (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown> {
    return async (serverId, toolName, args) => {
      const client = this.clients.get(serverId);
      if (!client) {
        throw new Error(`Cliente MCP "${serverId}" no está conectado`);
      }
      return client.callTool(toolName, args);
    };
  }

  /**
   * Desconecta todos los clientes MCP.
   */
  disconnectAll(): void {
    for (const [name, client] of this.clients) {
      console.log(`[MCPBridge] Desconectando servidor "${name}"...`);
      client.disconnect();
    }
    this.clients.clear();
  }

  /**
   * Retorna la cantidad de servidores MCP conectados.
   */
  get connectedCount(): number {
    return this.clients.size;
  }
}
