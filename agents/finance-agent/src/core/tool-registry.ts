import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createLogger } from './logger';
import { ApiGatewayClient } from '../api-gateway/client';
import type { CompanyConfig } from '../config/schema';
import { SchedulerClient } from './scheduler-client';
import { NotifierClient } from './notifier-client';

// ──────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────

const logger = createLogger('ToolRegistry');

// ──────────────────────────────────────────────
// ToolContext
// ──────────────────────────────────────────────

export interface ToolContext {
  apiGateway: ApiGatewayClient;
  config: CompanyConfig;
  vaultPath: string;
  scheduler: SchedulerClient;
  notifier: NotifierClient;
}

// ──────────────────────────────────────────────
// NativeToolDefinition
// ──────────────────────────────────────────────

export interface NativeToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
  version?: string;
  tags?: string[];
}

// ──────────────────────────────────────────────
// MCPToolDefinition
// ──────────────────────────────────────────────

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

// ──────────────────────────────────────────────
// ToolDefinition (unified for defineTool)
// ──────────────────────────────────────────────

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
  version?: string;
  tags?: string[];
}

// ──────────────────────────────────────────────
// ToolResult
// ──────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data: unknown;
  toolName: string;
  executionTimeMs: number;
  error?: string;
}

// ──────────────────────────────────────────────
// defineTool
// ──────────────────────────────────────────────

export function defineTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>
): NativeToolDefinition<TInput, TOutput> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: z.unknown() as z.ZodType<TOutput>,
    handler: def.handler,
    version: def.version,
    tags: def.tags,
  };
}

// ──────────────────────────────────────────────
// MCPToolExecutor
// ──────────────────────────────────────────────

/**
 * Función que ejecuta una tool MCP contra el servidor real. La provee
 * MCPBridge (ver core/mcp-bridge.ts) — ToolRegistry no conoce MCPClient
 * directamente para evitar un import circular entre ambos módulos.
 */
export type MCPToolExecutor = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// ──────────────────────────────────────────────
// ToolRegistry
// ──────────────────────────────────────────────

export class ToolRegistry {
  private nativeTools: Map<string, NativeToolDefinition> = new Map();
  private mcpTools: Map<string, MCPToolDefinition> = new Map();
  private mcpExecutor?: MCPToolExecutor;

  /** Conecta el ejecutor real de tools MCP (típicamente MCPBridge.createExecutor()). */
  setMCPExecutor(executor: MCPToolExecutor): void {
    this.mcpExecutor = executor;
  }

  registerNative(tool: NativeToolDefinition): void {
    if (this.nativeTools.has(tool.name)) {
      throw new Error(`La tool nativa "${tool.name}" ya está registrada`);
    }
    this.nativeTools.set(tool.name, tool);
    logger.info('Tool nativa registrada', { name: tool.name });
  }

  /** Alias de registerNative */
  registerNativeTool(tool: NativeToolDefinition): void {
    this.registerNative(tool);
  }

  registerMCP(tool: MCPToolDefinition): void {
    if (this.mcpTools.has(tool.name)) {
      throw new Error(`La tool MCP "${tool.name}" ya está registrada`);
    }
    this.mcpTools.set(tool.name, tool);
    logger.info('Tool MCP registrada', { name: tool.name, serverId: tool.serverId });
  }

  /** Alias de registerMCP */
  registerMCPTool(tool: MCPToolDefinition): void {
    this.registerMCP(tool);
  }

  getTool(name: string): NativeToolDefinition | MCPToolDefinition | undefined {
    return this.nativeTools.get(name) || this.mcpTools.get(name);
  }

  listTools(): Array<{
    name: string;
    description: string;
    type: 'native' | 'mcp';
    inputSchema: Record<string, unknown>;
  }> {
    // inputSchema tiene que ser JSON Schema real — el protocolo MCP (y
    // cualquier cliente que valide contra ListToolsResultSchema) lo exige.
    // Sin esto, tools/list responde con tools inválidas para cualquier
    // cliente MCP real, aunque los tests internos de este archivo no lo detecten.
    const native = Array.from(this.nativeTools.values()).map(t => ({
      name: t.name,
      description: t.description,
      type: 'native' as const,
      // Cast a `any`: zodToJsonSchema con el ZodType<unknown> genérico de
      // NativeToolDefinition hace explotar la inferencia de TS ("Type
      // instantiation is excessively deep") — inofensivo en runtime.
      inputSchema: zodToJsonSchema(t.inputSchema as any) as Record<string, unknown>,
    }));
    const mcp = Array.from(this.mcpTools.values()).map(t => ({
      name: t.name,
      description: t.description,
      type: 'mcp' as const,
      inputSchema: t.inputSchema,
    }));
    return [...native, ...mcp];
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx?: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    const nativeTool = this.nativeTools.get(name);
    if (nativeTool) {
      logger.info('Ejecutando tool nativa', { name });
      try {
        const parsedInput = nativeTool.inputSchema.parse(input);
        const data = await nativeTool.handler(parsedInput, ctx as ToolContext);
        return {
          success: true,
          data,
          toolName: name,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          data: null,
          toolName: name,
          executionTimeMs: Date.now() - startTime,
          error: errorMessage,
        };
      }
    }

    const mcpTool = this.mcpTools.get(name);
    if (mcpTool) {
      logger.info('Ejecutando tool MCP', { name, serverId: mcpTool.serverId });

      if (!this.mcpExecutor) {
        return {
          success: false,
          data: null,
          toolName: name,
          executionTimeMs: Date.now() - startTime,
          error: `No hay un ejecutor MCP configurado (llamá a setMCPExecutor() primero): ${name}`,
        };
      }

      try {
        // MCPBridge.discoverTools() registra las tools con prefijo
        // "{serverId}__{nombreOriginal}" — hay que despojar el prefijo antes
        // de llamar al servidor MCP real, que no lo conoce.
        const prefix = `${mcpTool.serverId}__`;
        const originalName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
        const data = await this.mcpExecutor(mcpTool.serverId, originalName, input);
        return {
          success: true,
          data,
          toolName: name,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          data: null,
          toolName: name,
          executionTimeMs: Date.now() - startTime,
          error: errorMessage,
        };
      }
    }

    return {
      success: false,
      data: null,
      toolName: name,
      executionTimeMs: Date.now() - startTime,
      error: `Tool no encontrada: ${name}`,
    };
  }
}