import { z } from 'zod';
import type { ToolDefinition, ExecutionContext } from '../types';

// ── Public re-export so consumers use the framework's zod instance ────────────
export { z };

// ── Typed tool definition ─────────────────────────────────────────────────────

/** Declarative facts about a tool that the engine and MCP clients use to decide how to treat it. */
export interface ToolMetadata {
    /** Human-readable name for UIs and MCP clients. */
    title?: string;
    /** Mutates nothing. Implies `concurrencySafe`; incompatible with `destructive`. MCP: `readOnlyHint`. */
    readOnly?: boolean;
    /** A write that cannot be undone from the outside. MCP: `destructiveHint`. */
    destructive?: boolean;
    /** Calling it again with the same arguments has no additional effect. MCP: `idempotentHint`. */
    idempotent?: boolean;
    /** Talks to entities outside the system. MCP: `openWorldHint`. */
    openWorld?: boolean;
    /** Free-form metadata for governance clients (never read by the engine). MCP: `_meta`. */
    meta?: Record<string, unknown>;
}

export interface TypedToolOptions<TInput extends z.ZodTypeAny> extends ToolMetadata {
    name: string;
    description: string;
    /** Zod schema for the tool's input. Used for validation and JSON Schema generation. */
    input: TInput;
    /** Safe to run in parallel with other concurrencySafe tools. Default false (true when `readOnly`). */
    concurrencySafe?: boolean;
    /** Time limit for one call in ms (overrides the engine's `toolTimeoutMs`). Default: none. */
    timeoutMs?: number;
    /** Per call, on the validated arguments: true asks a person even in "approve all" mode. See `ToolDefinition.alwaysAsk`. */
    alwaysAsk?: (args: z.infer<TInput>) => boolean;
    /** Type-safe execute handler — args are already validated and typed. */
    execute(args: z.infer<TInput>, ctx: ExecutionContext): Promise<string>;
}

/** A tool whose declared facts contradict each other (thrown at definition time, never at call time). */
export class ToolDefinitionError extends Error {
    constructor(readonly toolName: string, message: string) {
        super(`Tool "${toolName}": ${message}`);
        this.name = 'ToolDefinitionError';
    }
}

/**
 * Checks that a tool's declared facts are consistent. `defineTool` calls it; call it yourself on a hand-written
 * `ToolDefinition` before exposing it (the MCP tool server does).
 *
 * - `readOnly` and `destructive` cannot both be true.
 * - `concurrencySafe` means "read-only, order-independent", so a `destructive` tool cannot declare it.
 * - `timeoutMs`, when present, must be a positive number.
 * - `parameters` must describe an object.
 */
export function validateToolDefinition(tool: ToolDefinition): void {
    if (!tool.name) throw new ToolDefinitionError(tool.name ?? '', 'name is required');
    if (tool.readOnly && tool.destructive) {
        throw new ToolDefinitionError(tool.name, 'cannot be both readOnly and destructive');
    }
    if (tool.destructive && tool.concurrencySafe) {
        throw new ToolDefinitionError(tool.name, 'a destructive tool cannot be concurrencySafe');
    }
    if (tool.timeoutMs !== undefined && !(Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0)) {
        throw new ToolDefinitionError(tool.name, `timeoutMs must be a positive number (got ${String(tool.timeoutMs)})`);
    }
    if (tool.parameters && tool.parameters.type !== undefined && tool.parameters.type !== 'object') {
        throw new ToolDefinitionError(tool.name, `parameters must describe an object (got type "${String(tool.parameters.type)}")`);
    }
}

// Zod schema of each tool created by defineTool, so the MCP tool server can register the exact schema instead of
// converting the JSON Schema back. A WeakMap keeps ToolDefinition a plain, serialisable object.
const inputSchemas = new WeakMap<ToolDefinition, z.ZodTypeAny>();

/** The Zod schema a tool was defined with, or undefined for a hand-written ToolDefinition. */
export function getToolInputSchema(tool: ToolDefinition): z.ZodTypeAny | undefined {
    return inputSchemas.get(tool);
}

/**
 * Converts a Zod schema to the plain JSON Schema sent to LLMs (tool parameters, structured output):
 * OpenAPI 3 flavour, no `$ref`s, without the top-level `$schema` / `definitions` meta.
 */
export function zodToParameters(schema: z.ZodTypeAny): Record<string, unknown> {
    return stripTopLevelMeta(z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>);
}

/**
 * Creates a fully type-safe ToolDefinition backed by a Zod schema.
 *
 * The input schema is converted to JSON Schema for the LLM, and args are
 * validated at runtime before being passed to the execute handler.
 * Validation errors are returned as tool result strings (not thrown).
 *
 * Declared facts (`readOnly`, `destructive`, `idempotent`, `openWorld`, `meta`, `title`) are checked for
 * consistency here and throw `ToolDefinitionError` at definition time. `readOnly: true` implies `concurrencySafe`.
 *
 * @example
 * const readFileTool = defineTool({
 *   name: 'read_file',
 *   description: 'Read a file from disk',
 *   readOnly: true,
 *   input: z.object({
 *     path:     z.string().describe('Absolute path to the file'),
 *     encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
 *   }),
 *   execute: async ({ path, encoding }, ctx) => {
 *     // path: string, encoding: 'utf-8' | 'base64' — fully typed
 *     return readFileSync(path, encoding);
 *   },
 * });
 */
export function defineTool<TInput extends z.ZodTypeAny>(
    opts: TypedToolOptions<TInput>,
): ToolDefinition {
    const parameters = zodToParameters(opts.input);
    const concurrencySafe = opts.concurrencySafe || opts.readOnly === true;

    const tool: ToolDefinition = {
        name: opts.name,
        description: opts.description,
        parameters,
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(concurrencySafe ? { concurrencySafe: true } : {}),
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
        ...(opts.alwaysAsk ? { alwaysAsk: (raw: Record<string, unknown>) => { const r = opts.input.safeParse(raw); return r.success && opts.alwaysAsk!(r.data); } } : {}),
        ...(opts.destructive !== undefined ? { destructive: opts.destructive } : {}),
        ...(opts.idempotent !== undefined ? { idempotent: opts.idempotent } : {}),
        ...(opts.openWorld !== undefined ? { openWorld: opts.openWorld } : {}),
        ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
        execute: async (rawArgs: unknown, ctx: ExecutionContext) => {
            const result = opts.input.safeParse(rawArgs);
            if (!result.success) {
                const issues = result.error.issues
                    .map(i => `${i.path.join('.') || 'root'}: ${i.message}`)
                    .join('; ');
                return `Error: Invalid arguments for tool "${opts.name}" — ${issues}`;
            }
            return opts.execute(result.data, ctx);
        },
    };

    validateToolDefinition(tool);
    inputSchemas.set(tool, opts.input);
    return tool;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Remove top-level JSON Schema meta fields ($schema, definitions, etc.) */
function stripTopLevelMeta(schema: Record<string, unknown>): Record<string, unknown> {
    const { $schema, definitions, ...rest } = schema;
    void $schema; void definitions;
    return rest;
}
