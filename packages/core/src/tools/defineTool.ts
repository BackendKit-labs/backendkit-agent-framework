import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition, ExecutionContext } from '../types';

// ── Public re-export so consumers use the framework's zod instance ────────────
export { z };

// ── Typed tool definition ─────────────────────────────────────────────────────

export interface TypedToolOptions<TInput extends z.ZodTypeAny> {
    name: string;
    description: string;
    /** Zod schema for the tool's input. Used for validation and JSON Schema generation. */
    input: TInput;
    /** Safe to run in parallel with other concurrencySafe tools. Default false. */
    concurrencySafe?: boolean;
    /** Type-safe execute handler — args are already validated and typed. */
    execute(args: z.infer<TInput>, ctx: ExecutionContext): Promise<string>;
}

/**
 * Creates a fully type-safe ToolDefinition backed by a Zod schema.
 *
 * The input schema is converted to JSON Schema for the LLM, and args are
 * validated at runtime before being passed to the execute handler.
 * Validation errors are returned as tool result strings (not thrown).
 *
 * @example
 * const readFileTool = defineTool({
 *   name: 'read_file',
 *   description: 'Read a file from disk',
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
/**
 * Converts a Zod schema to the plain JSON Schema sent to LLMs (tool parameters, structured output):
 * OpenAPI 3 flavour, no `$ref`s, without the top-level `$schema` / `definitions` meta.
 */
export function zodToParameters(schema: z.ZodTypeAny): Record<string, unknown> {
    // Cast to bypass TypeScript's deep-instantiation limit on generic Zod schemas
    const toSchema = zodToJsonSchema as unknown as (s: z.ZodTypeAny, opts: object) => Record<string, unknown>;
    // zodToJsonSchema wraps the schema in a root object with $schema etc.
    return stripTopLevelMeta(toSchema(schema, { target: 'openApi3', $refStrategy: 'none' }));
}

export function defineTool<TInput extends z.ZodTypeAny>(
    opts: TypedToolOptions<TInput>,
): ToolDefinition {
    const parameters = zodToParameters(opts.input);

    return {
        name: opts.name,
        description: opts.description,
        parameters,
        ...(opts.concurrencySafe ? { concurrencySafe: true } : {}),
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
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Remove top-level JSON Schema meta fields ($schema, definitions, etc.) */
function stripTopLevelMeta(schema: Record<string, unknown>): Record<string, unknown> {
    const { $schema, definitions, ...rest } = schema;
    void $schema; void definitions;
    return rest;
}
