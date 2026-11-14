import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ExecutionContext, ToolDefinition } from '../types';
import { createToolContext } from '../tools/createToolContext';
import { getToolInputSchema, validateToolDefinition } from '../tools/defineTool';

/**
 * MCP tool server: exposes `ToolDefinition`s as MCP tools that run **directly**, with no model in between.
 *
 * Use it when the caller already knows what it wants (a balance at a date, post this draft, run this check)
 * and a language model would only add latency, cost and the chance of a rewritten argument. For requests
 * that need interpretation, `AgentMCPServer` in `@backendkit-labs/mcp-server` turns each call into a prompt
 * for an engine; both can coexist, and a prompt tool may itself call direct tools.
 *
 * What the server guarantees per call: the arguments are validated against the tool's schema before
 * `execute` runs (the MCP SDK answers invalid ones itself with `isError` and a `-32602` message; the hooks
 * below never see them), an optional `authorize` hook runs first,
 * the tool gets an `ExecutionContext` whose `signal` aborts on client cancellation or `timeoutMs`, the output
 * is capped, and every call (including denied and failed ones) reaches the `audit` hook.
 *
 * Error contract: `isError: true` means the call did not run to completion (denied, timed out, threw, output
 * too large). Whatever the tool *returned* is payload, even when it encodes a business failure.
 */

/** Facts about one incoming call, as given to `authorize` and `context`. */
export interface ToolCallInfo {
    tool: ToolDefinition;
    args: Record<string, unknown>;
    /** MCP session id when the transport has sessions (stdio and stateless HTTP have none). */
    sessionId?: string;
    requestId: string | number;
}

export type ToolCallOutcome = 'ok' | 'denied' | 'timeout' | 'error' | 'too_large';

/** What the `audit` hook receives for every call. The arguments travel as a hash, never in clear. */
export interface ToolCallRecord {
    at: string;
    server: string;
    tool: string;
    sessionId?: string;
    requestId: string | number;
    /** SHA-256 of the canonical JSON of the arguments (sorted keys). */
    argsHash: string;
    outcome: ToolCallOutcome;
    durationMs: number;
    /** Length of the text returned to the client (0 unless `outcome` is 'ok'). */
    outputChars: number;
    /** Message for outcomes other than 'ok'. */
    error?: string;
}

export interface ToolServerOptions {
    /** Server name announced to MCP clients. */
    name: string;
    /** Default '1.0.0'. */
    version?: string;
    tools: ToolDefinition[];
    /**
     * Fields of the `ExecutionContext` every tool receives (working directory, store, secrets...), or a function
     * that builds the whole context per call. `signal`, `agentId` (server name) and `sessionId` are filled in
     * by the server unless the function sets them.
     */
    context?: Partial<ExecutionContext> | ((call: ToolCallInfo & { signal: AbortSignal }) => ExecutionContext);
    /**
     * Decides whether a call may run. Required when any tool is `destructive`: a direct tool bypasses the
     * engine's `allowedTools`, gates and budget, so the server refuses to start without a gate of its own.
     * `false` or a throw produces `isError` with outcome 'denied'; the tool never runs.
     */
    authorize?: (call: ToolCallInfo) => boolean | Promise<boolean>;
    /**
     * Receives one record per call, after it finishes (also for denied and failed calls). A failure inside the
     * hook is written to stderr and does not change the result: the tool has already run.
     */
    audit?: (record: ToolCallRecord) => void | Promise<void>;
    /** Calls whose text exceeds this many characters fail with outcome 'too_large'. Default 1 048 576. */
    maxOutputChars?: number;
    /** Time limit for tools that declare none. Default: none. */
    toolTimeoutMs?: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 1_048_576;

interface PreparedTool {
    tool: ToolDefinition;
    schema: z.ZodTypeAny;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/**
 * Validates the tools once (names, declared facts, schemas) and returns a factory that builds a connected-ready
 * `McpServer` per call. The stateless HTTP transport needs a fresh server per request; stdio needs one.
 */
export function createToolServerFactory(opts: ToolServerOptions): () => McpServer {
    const prepared = prepareTools(opts);
    return () => buildServer(opts, prepared);
}

/** One `McpServer` with every tool registered. Connect it to any MCP server transport. */
export function createToolServer(opts: ToolServerOptions): McpServer {
    return createToolServerFactory(opts)();
}

// ── Preparation ───────────────────────────────────────────────────────────────

function prepareTools(opts: ToolServerOptions): PreparedTool[] {
    if (!opts.name) throw new Error('createToolServer: name is required');
    const seen = new Set<string>();
    const prepared: PreparedTool[] = [];

    for (const tool of opts.tools) {
        validateToolDefinition(tool);
        if (seen.has(tool.name)) throw new Error(`createToolServer(${opts.name}): duplicate tool name "${tool.name}"`);
        seen.add(tool.name);
        if (tool.destructive && !opts.authorize) {
            throw new Error(
                `createToolServer(${opts.name}): tool "${tool.name}" is destructive and no authorize hook was given. ` +
                'A direct tool skips the engine\'s allowedTools, gates and budget; the server must gate it itself.',
            );
        }
        prepared.push({ tool, schema: inputSchemaOf(opts.name, tool), annotations: annotationsOf(tool) });
    }
    return prepared;
}

/**
 * The schema a tool is registered with. Tools from `defineTool` carry their Zod schema, which is used as is:
 * no conversion, so what the client validates against is exactly what `execute` validates against. A
 * hand-written `ToolDefinition` only has JSON Schema; it goes through `z.fromJSONSchema`, which rejects
 * constructs it cannot express (`if/then/else`, `not`, external `$ref`) instead of degrading silently.
 */
function inputSchemaOf(serverName: string, tool: ToolDefinition): z.ZodTypeAny {
    const own = getToolInputSchema(tool);
    if (own) return own;
    try {
        return z.fromJSONSchema(tool.parameters as Parameters<typeof z.fromJSONSchema>[0], { defaultTarget: 'openapi-3.0' });
    } catch (err) {
        throw new Error(
            `createToolServer(${serverName}): cannot derive an input schema for tool "${tool.name}" from its JSON Schema: ` +
            `${(err as Error).message}. Define it with defineTool, or simplify the schema.`,
        );
    }
}

function annotationsOf(tool: ToolDefinition): PreparedTool['annotations'] {
    const a: NonNullable<PreparedTool['annotations']> = {};
    if (tool.readOnly !== undefined) a.readOnlyHint = tool.readOnly;
    if (tool.destructive !== undefined) a.destructiveHint = tool.destructive;
    if (tool.idempotent !== undefined) a.idempotentHint = tool.idempotent;
    if (tool.openWorld !== undefined) a.openWorldHint = tool.openWorld;
    return Object.keys(a).length > 0 ? a : undefined;
}

// ── Server ────────────────────────────────────────────────────────────────────

function buildServer(opts: ToolServerOptions, prepared: PreparedTool[]): McpServer {
    const server = new McpServer({ name: opts.name, version: opts.version ?? '1.0.0' });
    const maxOutputChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

    for (const { tool, schema, annotations } of prepared) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                ...(tool.title !== undefined ? { title: tool.title } : {}),
                // The SDK accepts a whole Zod object schema here, not only a raw shape.
                inputSchema: schema as never,
                ...(annotations ? { annotations } : {}),
                ...(tool.meta ? { _meta: tool.meta } : {}),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (async (args: any, extra: any) => runCall(opts, tool, maxOutputChars, args, extra)) as never,
        );
    }
    return server;
}

interface CallExtra {
    signal: AbortSignal;
    sessionId?: string;
    requestId: string | number;
}

async function runCall(
    opts: ToolServerOptions,
    tool: ToolDefinition,
    maxOutputChars: number,
    rawArgs: unknown,
    extra: CallExtra,
): Promise<CallToolResult> {
    const started = Date.now();
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
    const info: ToolCallInfo = { tool, args, requestId: extra.requestId, ...(extra.sessionId ? { sessionId: extra.sessionId } : {}) };

    const finish = async (outcome: ToolCallOutcome, text: string, error?: string): Promise<CallToolResult> => {
        await audit(opts, {
            at: new Date(started).toISOString(),
            server: opts.name,
            tool: tool.name,
            ...(info.sessionId ? { sessionId: info.sessionId } : {}),
            requestId: extra.requestId,
            argsHash: hashArgs(args),
            outcome,
            durationMs: Date.now() - started,
            outputChars: outcome === 'ok' ? text.length : 0,
            ...(error !== undefined ? { error } : {}),
        });
        return outcome === 'ok'
            ? { content: [{ type: 'text', text }] }
            : { content: [{ type: 'text', text }], isError: true };
    };

    // 1. Authorization — before anything else runs.
    if (opts.authorize) {
        let allowed = false;
        let reason = 'denied by authorize';
        try {
            allowed = await opts.authorize(info);
        } catch (err) {
            reason = `authorize threw: ${messageOf(err)}`;
        }
        if (!allowed) return finish('denied', `Tool "${tool.name}" denied: ${reason}`, reason);
    }

    // 2. Cancellation: client abort or time limit, whichever comes first.
    const timeoutMs = tool.timeoutMs ?? opts.toolTimeoutMs;
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(extra.signal.reason);
    if (extra.signal.aborted) onClientAbort();
    else extra.signal.addEventListener('abort', onClientAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
        if (timeoutMs === undefined) return;
        timer = setTimeout(() => {
            controller.abort(new Error(`TOOL_TIMEOUT after ${timeoutMs}ms`));
            reject(new ToolTimeout(timeoutMs));
        }, timeoutMs);
    });

    // 3. Context and execution.
    try {
        const ctx = contextFor(opts, info, controller.signal);
        const output = await Promise.race([tool.execute(args, ctx), timedOut]);
        const text = typeof output === 'string' ? output : JSON.stringify(output);
        if (text.length > maxOutputChars) {
            const msg = `Tool "${tool.name}" returned ${text.length} characters; the limit is ${maxOutputChars}`;
            return finish('too_large', msg, msg);
        }
        return finish('ok', text);
    } catch (err) {
        if (err instanceof ToolTimeout) {
            const msg = `Tool "${tool.name}" timed out after ${err.timeoutMs}ms`;
            return finish('timeout', msg, msg);
        }
        // No stack: the client is on the other side of a wire and gets the message only.
        const msg = messageOf(err);
        return finish('error', `Tool "${tool.name}" failed: ${msg}`, msg);
    } finally {
        if (timer) clearTimeout(timer);
        extra.signal.removeEventListener('abort', onClientAbort);
        timedOut.catch(() => undefined);
    }
}

class ToolTimeout extends Error {
    constructor(readonly timeoutMs: number) { super(`timed out after ${timeoutMs}ms`); }
}

function contextFor(opts: ToolServerOptions, info: ToolCallInfo, signal: AbortSignal): ExecutionContext {
    if (typeof opts.context === 'function') return opts.context({ ...info, signal });
    return createToolContext({
        agentId: opts.name,
        sessionId: info.sessionId ?? 'mcp',
        ...opts.context,
        signal,
    });
}

async function audit(opts: ToolServerOptions, record: ToolCallRecord): Promise<void> {
    if (!opts.audit) return;
    try {
        await opts.audit(record);
    } catch (err) {
        process.stderr.write(`[${opts.name}] audit hook failed for ${record.tool}: ${messageOf(err)}\n`);
    }
}

/** SHA-256 over the canonical JSON (sorted keys at every level) so equal arguments hash equal. */
export function hashArgs(args: unknown): string {
    return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.keys(value as Record<string, unknown>).sort()
        .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
