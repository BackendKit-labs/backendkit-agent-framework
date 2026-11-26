import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { hashArgs } from '../shared/utils/canonical-json';
import type { ExecutionContext, ToolDefinition } from '../types';
import { createToolContext } from '../tools/createToolContext';
import { getToolInputSchema, validateToolDefinition } from '../tools/defineTool';
import { AuditDispatcher } from '../governance/audit';
import { agentCouldPerform, evaluatePolicies } from '../governance/policy';
import { checkApproval } from '../governance/approval';
import { IdentityResolver, type AgentIdentity, type AgentIdentityContext, type AgentIdentityProvider } from '../governance/agent-identity';
import { eventSigningMessage } from '../governance/agent-signature';
import type {
    ApprovalRequest, Approver, ApproverAuthority, ApproverDirectory, ApproverRef, AuditDecision, AuditEvent, AuditMandate, AuditOutcome, AuditSink, Identity, PolicyDecision, Principal, ToolPolicy,
} from '../governance/types';
import { randomUUID } from 'node:crypto';
import { ToolError } from '../tools/tool-error';
import { errorCodeOf } from '../engine/error-code';

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
 * too large). Whatever the tool *returned* is payload, even when it encodes a business failure. A tool that throws a
 * `ToolError` (`code`, `message`) tells the client why: its message is meant for them. Any other thrown error is internal: the
 * client gets an `errorId`, the error itself goes to `onInternalError` under that id, and the audit event records the error's
 * code, never its message (an exception message can carry paths, queries or credentials).
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
     * Decides whether a call may run: the simple yes/no gate. A `destructive` tool needs this or `policy`: a direct
     * tool bypasses the engine's `allowedTools`, gates and budget, so the server refuses to start without a gate.
     * `false` or a throw produces `isError` with outcome 'denied'; the tool never runs.
     */
    authorize?: (call: ToolCallInfo) => boolean | Promise<boolean>;
    /**
     * The same `ToolPolicy` contract the engine uses (SPEC-0014): allow, deny or ask, per call, with the principal.
     * Runs after `authorize`. An `ask` goes to `approver`; without one it is refused. Several combine: deny > ask > allow.
     */
    policy?: ToolPolicy | ToolPolicy[];
    /** Answers an `ask` now. Its answer is validated (accepted kind, no self-approval, the roles the `ask` names) before it counts. */
    approver?: Approver;
    /**
     * Who the approvers are and what roles they hold. A policy that asks with `approverRoles` is approved only by someone who holds one, and with no
     * directory it cannot be approved at all: an approval that cannot be checked is not accepted (SPEC-0041).
     */
    approverDirectory?: ApproverDirectory;
    /** Four eyes: whoever the server acts for (`identity.userId`) does not approve the call either. With no `identity.userId` the call is denied. */
    forbidSelfApproval?: boolean;
    /** Who the server acts for; part of the principal policies and audit events see. Its `userId` is required unless `requireAgentIdentity` is off. */
    identity?: Identity;
    /**
     * Gives the server its digital identity (SPEC-0044): who executes the calls. The same contract and the same default as the engine: every call
     * is attributed to it in the audit and signed by it when the provider can sign. See `selfAssertedIdentities`, `ed25519AgentIdentities`.
     */
    agentIdentity?: AgentIdentityProvider;
    /**
     * Default `true`: without an identity for the server and `identity.userId`, every call is denied, with a reason that says how to fix it. A direct
     * tool is the other way to run a tool, and it must not be a way around the requirement. `false` is for tests only.
     */
    requireAgentIdentity?: boolean;
    /** How long the identity provider has to answer before the call is denied. Default 5000. */
    agentIdentityTimeoutMs?: number;
    /** How long an answer of the provider is reused. Default 5000; `0` asks on every call. */
    agentIdentityCacheMs?: number;
    /** Default `true`: audit events are signed by the identity of the server when its provider can sign (SPEC-0044 F2). */
    signAuditEvents?: boolean;
    /**
     * Receives one record per call, after it finishes (also for denied and failed calls). A failure inside the
     * hook is written to stderr and does not change the result: the tool has already run.
     * @deprecated Use `auditSink`, which receives the same `AuditEvent` the engine writes.
     */
    audit?: (record: ToolCallRecord) => void | Promise<void>;
    /** One `AuditEvent` per call (the engine's format), in call order. Failures go to stderr. */
    auditSink?: AuditSink | AuditSink[];
    /** Calls whose text exceeds this many characters fail with outcome 'too_large'. Default 1 048 576. */
    maxOutputChars?: number;
    /** Time limit for tools that declare none. Default: none. */
    toolTimeoutMs?: number;
    /**
     * Where an internal error goes: one a tool, `authorize` or the approver threw that is not a `ToolError`. The client only gets
     * its `errorId`; this receives the error itself under that id. Default: stderr.
     */
    onInternalError?: (err: unknown, info: { errorId: string; server: string; tool: string; where: string; requestId: string | number }) => void;
}

const DEFAULT_MAX_OUTPUT_CHARS = 1_048_576;

interface PreparedTool {
    tool: ToolDefinition;
    schema: z.ZodTypeAny;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/**
 * Validates the tools once (names, declared facts, schemas) and returns a function that registers them, with
 * the per-call guarantees above, on any `McpServer`: one that also serves prompt tools, resources or prompts
 * of its own. `createToolServerFactory` is this plus a fresh `McpServer` per call.
 */
export function createToolRegistrar(opts: ToolServerOptions): (server: McpServer) => void {
    const prepared = prepareTools(opts);
    const maxOutputChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    return server => registerTools(server, opts, prepared, maxOutputChars);
}

/**
 * Validates the tools once and returns a factory that builds a connected-ready `McpServer` per call. The
 * stateless HTTP transport needs a fresh server per request; stdio needs one.
 */
export function createToolServerFactory(opts: ToolServerOptions): () => McpServer {
    const register = createToolRegistrar(opts);
    return () => {
        const server = new McpServer({ name: opts.name, version: opts.version ?? '1.0.0' });
        register(server);
        return server;
    };
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
        if (tool.destructive && !opts.authorize && !opts.policy) {
            throw new Error(
                `createToolServer(${opts.name}): tool "${tool.name}" is destructive and no authorize hook or policy was given. ` +
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

/** Per-server state shared by every call: the policies and the audit dispatcher (one order for all calls). */
interface Governance {
    policies: ToolPolicy[];
    sinks: AuditDispatcher;
    identities: IdentityResolver;
}

const governanceOf = new WeakMap<ToolServerOptions, Governance>();

function governance(opts: ToolServerOptions): Governance {
    let g = governanceOf.get(opts);
    if (!g) {
        g = {
            policies: opts.policy ? (Array.isArray(opts.policy) ? opts.policy : [opts.policy]) : [],
            sinks: new AuditDispatcher(opts.auditSink, (err) =>
                process.stderr.write(`[${opts.name}] audit sink failed: ${messageOf(err)}\n`)),
            identities: new IdentityResolver({
                ...(opts.agentIdentity ? { provider: opts.agentIdentity } : {}),
                ...(opts.requireAgentIdentity !== undefined ? { require: opts.requireAgentIdentity } : {}),
                ...(opts.agentIdentityTimeoutMs !== undefined ? { timeoutMs: opts.agentIdentityTimeoutMs } : {}),
                ...(opts.agentIdentityCacheMs !== undefined ? { cacheMs: opts.agentIdentityCacheMs } : {}),
                warn: (text) => process.stderr.write(`[${opts.name}] ${text}\n`),
            }),
        };
        governanceOf.set(opts, g);
    }
    return g;
}

function registerTools(server: McpServer, opts: ToolServerOptions, prepared: PreparedTool[], maxOutputChars: number): void {
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
    const gov = governance(opts);
    const principal: Principal = {
        ...opts.identity,
        agentId: opts.name,
        sessionId: info.sessionId ?? 'mcp',
        chain: [opts.name],
    };
    let approval: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string } | undefined;
    // Why a person was asked, and which mandate the call went beyond: they go to the audit event of the approved call.
    let asked: { reason: string; exceeds?: AuditMandate } | undefined;
    let policyDecision: AuditDecision = 'allow';
    // SPEC-0044: who executes this call, and for whom. Resolved before anything else runs; the audit event is attributed to it.
    const identityContext = { sessionId: principal.sessionId, ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}), ...(principal.userId !== undefined ? { userId: principal.userId } : {}) };
    const who = await gov.identities.check(opts.name, identityContext);
    if (who.ok && who.identity) principal.agentIdentity = who.identity;

    /** An internal error as the client sees it: a generic line with its `errorId`. The error itself goes to `onInternalError`. */
    const internal = (err: unknown, where: string): string => {
        const errorId = randomUUID();
        const info = { errorId, server: opts.name, tool: tool.name, where, requestId: extra.requestId };
        try {
            if (opts.onInternalError) opts.onInternalError(err, info);
            else process.stderr.write(`[${opts.name}] internal error ${errorId} in ${where} of ${tool.name}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}
`);
        } catch { /* a failing logger must not change the answer */ }
        return `internal error (${errorId}): the detail is in the server's logs`;
    };
    // The code of the error a call failed with, for the audit event: a stable code, never a message.
    let failedCode: string | undefined;

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
        if (gov.sinks.enabled) {
            const ran = outcome !== 'denied';
            const event: AuditEvent = {
                at: new Date(started).toISOString(),
                principal: {
                    agentId: principal.agentId, sessionId: principal.sessionId, chain: principal.chain,
                    ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}),
                    ...(principal.userId !== undefined ? { userId: principal.userId } : {}),
                },
                tool: tool.name,
                argsHash: hashArgs(args),
                decision: ran ? 'allow' : policyDecision === 'allow' ? 'deny' : policyDecision,
                // A refusal says why (the policy, the identity); a failure only by its code: an exception message never reaches the audit.
                ...(!ran && error !== undefined ? { reason: error } : asked ? { reason: asked.reason } : {}),
                ...(ran ? { outcome: outcome as AuditOutcome } : {}),
                ...(failedCode ? { errorCode: failedCode } : {}),
                durationMs: Date.now() - started,
                ...(approval ? { approval } : {}),
                ...(asked?.exceeds ? { exceeded: asked.exceeds } : {}),
                ...(tool.meta ? { meta: tool.meta } : {}),
            };
            const attributed = who.ok ? who.identity : gov.identities.peek(opts.name);
            const attributedEvent: AuditEvent = { ...event, ...(attributed ? { agentIdentity: attributed } : { agentIdentityMissing: true as const }) };
            await gov.sinks.write(await signedEvent(opts, gov, attributedEvent, attributed, identityContext));
        }
        return outcome === 'ok'
            ? { content: [{ type: 'text', text }] }
            : { content: [{ type: 'text', text }], isError: true };
    };

    // 0. Identity: no identity for the server, or no one to act for, and nothing runs.
    if (!who.ok) return finish('denied', `Tool "${tool.name}" denied: ${who.reason}`, who.reason);

    // 1. Authorization — before anything else runs.
    if (opts.authorize) {
        let allowed = false;
        let reason = 'denied by authorize';
        try {
            allowed = await opts.authorize(info);
        } catch (err) {
            reason = `authorize failed: ${internal(err, 'authorize')}`;
        }
        if (!allowed) return finish('denied', `Tool "${tool.name}" denied: ${reason}`, reason);
    }

    // 2. Policy (SPEC-0014 contract): deny, ask (to the approver, validated) or allow, with an optional mode.
    let mode: 'run' | 'sandboxed' | 'dry_run' | undefined;
    if (gov.policies.length > 0) {
        const d = await evaluatePolicies(gov.policies, principal, { tool, args });
        if (d.effect === 'deny') return finish('denied', `Tool "${tool.name}" denied: ${d.reason}`, d.reason);
        if (d.effect === 'ask') {
            const resolved = await resolveAsk(opts, gov, principal, tool, args, d, (err) => internal(err, 'approver'));
            if (!resolved.ok) {
                policyDecision = 'deny';
                return finish('denied', `Tool "${tool.name}" denied: ${resolved.reason}`, resolved.reason);
            }
            approval = resolved.approval;
            asked = { reason: d.reason, ...(d.exceeds ? { exceeds: d.exceeds } : {}) };
        } else {
            mode = d.mode;
        }
    }

    // 3. Cancellation: client abort or time limit, whichever comes first.
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

    // 4. Context and execution.
    try {
        const ctx: ExecutionContext = {
            ...contextFor(opts, info, controller.signal),
            principal,
            ...(mode === 'dry_run' ? { dryRun: true } : {}),
        };
        if (mode === 'sandboxed' && !ctx.sandbox) {
            const reason = 'the policy requires a sandbox and the tool context has none';
            policyDecision = 'deny';
            return finish('denied', `Tool "${tool.name}" denied: ${reason}`, reason);
        }
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
        failedCode = errorCodeOf(err);
        // A ToolError is meant for the client; any other error is internal: the client gets its errorId, never its message.
        const msg = err instanceof ToolError ? err.message : internal(err, 'execute');
        return finish('error', `Tool "${tool.name}" failed: ${msg}`, msg);
    } finally {
        if (timer) clearTimeout(timer);
        extra.signal.removeEventListener('abort', onClientAbort);
        timedOut.catch(() => undefined);
    }
}

/** The event signed by the identity of the server (SPEC-0044 F2), or marked unsigned when it cannot sign: the record is never lost. */
async function signedEvent(opts: ToolServerOptions, gov: Governance, event: AuditEvent, identity: AgentIdentity | undefined, context: AgentIdentityContext): Promise<AuditEvent> {
    if (opts.signAuditEvents === false || !identity || !gov.identities.canSign) return event;
    try {
        return { ...event, agentSignature: await gov.identities.sign(opts.name, context, eventSigningMessage(event)) };
    } catch {
        return { ...event, agentSignatureFailed: true };
    }
}

/**
 * An `ask` in the tool server: the approver answers now, its answer is validated (accepted kind, no self-approval,
 * an agent approver must itself be allowed by the policies), or the call is refused. There is no pending store
 * here: an MCP client waits for its answer.
 */
async function resolveAsk(
    opts: ToolServerOptions, gov: Governance, principal: Principal, tool: ToolDefinition, args: Record<string, unknown>,
    d: Extract<PolicyDecision, { effect: 'ask' }>,
    /** Turns an error of the approver into what the client sees (an errorId); the error itself goes to the server's log. */
    internal: (err: unknown) => string,
): Promise<{ ok: true; approval: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string } } | { ok: false; reason: string }> {
    if (!opts.approver) return { ok: false, reason: `needs approval (${d.reason}) and no approver is configured` };
    const request: ApprovalRequest = {
        id: randomUUID(), principal, subject: { kind: 'tool_call', call: { tool, args } }, reason: d.reason,
        ...(d.approver ? { approver: d.approver } : {}), ...(d.accepts ? { accepts: d.accepts } : {}), ...(d.approverRoles ? { approverRoles: d.approverRoles } : {}),
        createdAt: new Date().toISOString(),
    };
    let answer;
    try {
        answer = await opts.approver.request(request);
    } catch (err) {
        return { ok: false, reason: `the approver failed: ${internal(err)}` };
    }
    if (answer.decision !== 'approve') return { ok: false, reason: answer.reason ?? 'rejected by the approver' };
    const checked = await checkApproval(answer, request, {
        canAgentAct: async (by) => {
            const asAgent = await evaluatePolicies(gov.policies, { ...principal, agentId: by.id, chain: by.chain ?? [by.id] }, { tool, args });
            return agentCouldPerform(asAgent);
        },
        ...(opts.approverDirectory ? { approverDirectory: opts.approverDirectory } : {}),
        ...(opts.forbidSelfApproval ? { forbidSelfApproval: true, requireRequester: true } : {}),
    });
    if ('problem' in checked) return { ok: false, reason: `invalid approval: ${checked.problem}` };
    return { ok: true, approval: { id: request.id, by: answer.by, ...(checked.authority ? { authority: checked.authority } : {}), ...(answer.reason ? { reason: answer.reason } : {}) } };
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

/** Re-exported so existing imports from the tool server keep working; the implementation lives in shared/utils. */
export { hashArgs };

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
