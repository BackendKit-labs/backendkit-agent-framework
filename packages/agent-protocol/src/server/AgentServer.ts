import express, { Express, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
    CONTROL_ACTIONS,
    PROTOCOL_MINOR,
    type AgentInfo,
    type CapabilityDefinition,
    type AgentContext,
    type CapabilityGate,
    type CapabilityGateResult,
    type ControlAction,
    type FlowDescriptor,
    type RunRequest,
    type RunSummary,
    type ProtocolResponse,
    type ErrorCode,
    type ResponseMeta,
} from '../types';
import { ControlError, statusForCode, type ControlHandler } from './ControlHandler';
import type { FlowHandler } from './FlowHandler';
import type { ApprovalHandler } from './ApprovalHandler';
import type { ApprovalDecision, ApprovalDecisionRequest, ApprovalStatus, ApproverRef } from '../types';
import { FLOW_STEER_ACTIONS, type FlowSteerAction } from '../types';
import { TaskStore } from './TaskStore';


/** Constant-time comparison of a presented Bearer token with the expected key. */
function keyMatches(header: string | undefined, key: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
}

export interface CapabilityHandler {
    definition: CapabilityDefinition;
    execute:    (input: Record<string, unknown>, context: AgentContext) => Promise<unknown>;
}

export interface AgentServerOptions {
    name:        string;
    version:     string;
    description: string;
    port?:       number;
    /** Interface to bind. Default `127.0.0.1`; use `0.0.0.0` (and set `apiKey`) to accept remote callers. */
    host?:       string;
    apiKey?:     string;
    /**
     * Refuse to be reachable without an `apiKey`: the constructor throws when `host` is not a loopback address and
     * no `apiKey` is set. Without `strict` that combination only logs a warning when the server starts, because
     * it leaves every capability open to the network. Default: false.
     */
    strict?:     boolean;
    evictIntervalMs?: number; // how often to evict old tasks, default 10 min
    /**
     * Key for the control endpoints (`/v1/agent/control`, `/runs`, `/audit`). Deliberately separate from `apiKey`:
     * whoever may run capabilities may not thereby change the agent's policy. Without it those endpoints answer
     * `FORBIDDEN`, whatever else is configured.
     */
    controlApiKey?: string;
    /** What the control actions do. Without it (and with `controlApiKey`) only `drain` and `resume` work. */
    control?: ControlHandler;
    /** Declared limits, published in `info`. */
    limits?: Record<string, number>;
    /** Flows this agent hosts, published in `info`. */
    flows?: FlowDescriptor[];
    /** Runs the flows this agent hosts so a supervisor can start, watch and steer them. Its flows are published in `info.flows`. */
    flowHandler?: FlowHandler;
    /** Lets a supervisor list what waits for a person and decide it (protocol 1.2). Needs `controlApiKey`. */
    approvalHandler?: ApprovalHandler;
    /**
     * Decides every run (a capability or the start of a flow) before it starts: under which identity and for whom (SPEC-0044). **Required by
     * default**: without a gate the server refuses to run anything, because a capability is another way to act and must not be a way around the
     * identity the rest of the framework requires. `capabilityIdentityGate` of `@backendkit-labs/agent-core` builds one.
     */
    gate?: CapabilityGate;
    /** Run with no gate, for tests only. Default false. */
    allowUngated?: boolean;
    /**
     * Who decides an approval, from something the server can verify (a personal token in a header, say): the control key only says
     * "a supervisor we know", not who is behind it. Without it the decider is `{ kind: 'service', id: 'control-key' }`, so what
     * only a person may approve cannot be approved through the protocol. Return undefined when the caller cannot be identified (401).
     */
    approverOf?: (call: { headers: Request['headers'] }) => ApproverRef | undefined | Promise<ApproverRef | undefined>;
}

/** Who decides an approval when the server has no `approverOf`: whoever holds the control key, as a service. */
export const CONTROL_KEY_APPROVER: ApproverRef = { kind: 'service', id: 'control-key' };

const APPROVER_KINDS = ['human', 'agent', 'service'];
const isApproverRef = (v: unknown): v is ApproverRef =>
    !!v && typeof v === 'object' && typeof (v as ApproverRef).id === 'string' && !!(v as ApproverRef).id && APPROVER_KINDS.includes((v as ApproverRef).kind);

const isLoopback = (host: string): boolean => host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/**
 * Whether the `Host` header and, if present, the `Origin` header are loopback. A server bound to 127.0.0.1 can still be reached from
 * a page in the user's browser through a rebinding DNS name. A copy of `isLoopbackRequest` of agent-core, which this package cannot
 * depend on (agent-core depends on it); keep the copies in step (SPEC-0013 D6).
 */
function isLoopbackRequest(host: string | undefined, origin: string | undefined): boolean {
    if (!host || !LOOPBACK_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase())) return false;
    if (origin === undefined) return true; // non-browser clients send no Origin
    try {
        return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase().replace(/^(::1)$/, '[::1]'));
    } catch {
        return false;
    }
}

export class AgentServer {
    private readonly app:        Express;
    private readonly taskStore:  TaskStore;
    private readonly handlers:   Map<string, CapabilityHandler>;
    private readonly info:       AgentInfo;
    private readonly port:       number;
    private readonly host:       string;
    private readonly apiKey?:    string;
    private readonly controlApiKey?: string;
    private readonly control?:   ControlHandler;
    private readonly flowHandler?: FlowHandler;
    private readonly approvalHandler?: ApprovalHandler;
    private readonly gate?: CapabilityGate;
    private readonly allowUngated: boolean;
    private readonly approverOf?: AgentServerOptions['approverOf'];
    private draining = false;
    private server:              ReturnType<Express['listen']> | null = null;
    private evictTimer?:         ReturnType<typeof setInterval>;

    constructor(opts: AgentServerOptions) {
        this.port      = opts.port ?? 3300;
        this.host      = opts.host ?? '127.0.0.1';
        this.apiKey    = opts.apiKey;
        if (opts.strict && !opts.apiKey && !isLoopback(this.host)) {
            throw new Error(`AgentServer: strict mode refuses to listen on "${this.host}" without an apiKey.`);
        }
        this.controlApiKey = opts.controlApiKey;
        this.control   = opts.control;
        this.flowHandler = opts.flowHandler;
        this.approvalHandler = opts.approvalHandler;
        if (opts.gate) this.gate = opts.gate;
        this.allowUngated = opts.allowUngated === true;
        if (opts.approverOf) this.approverOf = opts.approverOf;
        this.taskStore = new TaskStore();
        this.handlers  = new Map();
        this.info      = {
            name: opts.name, version: opts.version, description: opts.description, capabilities: [],
            protocolMinor: PROTOCOL_MINOR,
            ...(opts.limits ? { limits: opts.limits } : {}),
            ...(opts.flows || opts.flowHandler ? { flows: opts.flows ?? opts.flowHandler!.flows() } : {}),
            ...(opts.flowHandler ? { flowControl: true } : {}),
            ...(opts.approvalHandler ? { approvals: true } : {}),
            ...(opts.controlApiKey ? { control: this.controlActions() } : {}),
        };
        this.app       = express();
        this.setupMiddleware();
        this.setupRoutes();

        const evictMs = opts.evictIntervalMs ?? 10 * 60 * 1000;
        this.evictTimer = setInterval(() => this.taskStore.evict(), evictMs);
    }

    register(handler: CapabilityHandler): this {
        this.handlers.set(handler.definition.name, handler);
        this.info.capabilities.push(handler.definition);
        return this;
    }

    /**
     * The gate of a run (SPEC-0044). With no gate the server refuses, unless `allowUngated`. A gate that throws, or returns something that is not
     * an answer, refuses too: it never means "let it through".
     */
    private async passGate(
        req: Request, capability: string, input: Record<string, unknown>, context: AgentContext,
    ): Promise<{ ok: true; context?: Partial<AgentContext>; finish?: NonNullable<Extract<CapabilityGateResult, { ok: true }>['finish']> } | { ok: false; status: number; code: ErrorCode; message: string }> {
        if (!this.gate) {
            if (this.allowUngated) return { ok: true };
            return {
                ok: false, status: 403, code: 'FORBIDDEN',
                message: 'This agent has no identity gate, so it runs nothing: pass `gate` to AgentServer (see `capabilityIdentityGate` of @backendkit-labs/agent-core), or `allowUngated: true` for tests only',
            };
        }
        let answer: CapabilityGateResult;
        try {
            answer = await this.gate({ capability, input, context, headers: req.headers });
        } catch (err) {
            return { ok: false, status: 403, code: 'FORBIDDEN', message: `the identity gate failed: ${(err as Error).message}` };
        }
        if (!answer || typeof answer !== 'object' || typeof answer.ok !== 'boolean') {
            return { ok: false, status: 403, code: 'FORBIDDEN', message: 'the identity gate returned something that is not an answer' };
        }
        if (!answer.ok) {
            const unauthorized = answer.code === 'UNAUTHORIZED';
            return { ok: false, status: unauthorized ? 401 : 403, code: unauthorized ? 'UNAUTHORIZED' : 'FORBIDDEN', message: String(answer.message) };
        }
        const { context: more, finish } = answer;
        const safeFinish = finish ? async (o: { ok: boolean; error?: string }) => { try { await finish.call(answer, o); } catch { /* recording must not change the answer */ } } : undefined;
        return { ok: true, ...(more ? { context: more } : {}), ...(safeFinish ? { finish: safeFinish } : {}) };
    }

    // ── Middleware ──────────────────────────────────────────────────────────

    private setupMiddleware(): void {
        // On loopback with no apiKey nothing authenticates a request: only its Host and Origin say it comes from this machine and not
        // from a web page the user opened. With an apiKey a foreign page has no key, so the check is not needed (and would refuse proxies).
        if (!this.apiKey && isLoopback(this.host)) {
            this.app.use((req: Request, res: Response, next: NextFunction) => {
                if (isLoopbackRequest(req.headers.host, req.headers.origin)) return next();
                res.status(403).json(this.errEnvelope('FORBIDDEN', 'Forbidden host or origin: without an apiKey only loopback callers are served'));
            });
        }
        this.app.use(express.json({ limit: '10mb' }));
    }

    /**
     * Every route but `health` declares which key opens it, as the first handler of the route itself: `runKey` (the `apiKey`) or
     * `controlKey`. The check runs exactly when the route matched, however the client spelled the URL. Deciding it apart, by
     * comparing paths, let `/V1/agent/control` or `/v1/agent/runs/` through to the control routes with no control key, because the
     * router ignores case and a trailing slash and the comparison did not.
     */
    readonly runKey = (req: Request, res: Response, next: NextFunction): void => {
        if (this.apiKey && !keyMatches(req.headers.authorization, this.apiKey)) {
            res.status(401).json(this.errEnvelope('UNAUTHORIZED', 'Invalid or missing API key'));
            return;
        }
        next();
    };

    /** Control routes need the control key and nothing else opens them; without one configured they are off. */
    readonly controlKey = (req: Request, res: Response, next: NextFunction): void => {
        if (!this.controlApiKey) {
            res.status(403).json(this.errEnvelope('FORBIDDEN', 'Control endpoints are disabled: no controlApiKey is configured'));
            return;
        }
        if (!keyMatches(req.headers.authorization, this.controlApiKey)) {
            res.status(401).json(this.errEnvelope('UNAUTHORIZED', 'Invalid or missing control key'));
            return;
        }
        next();
    };

    // ── Routes ──────────────────────────────────────────────────────────────

    private setupRoutes(): void {
        this.app.get('/v1/agent/health', (_req, res) => {
            res.json(this.okEnvelope({ status: 'ok' }));
        });

        this.app.get('/v1/agent/info', this.runKey, (_req, res) => {
            res.json(this.okEnvelope(this.info, { agentVersion: this.info.version }));
        });

        this.app.post('/v1/agent/run', this.runKey, async (req: Request, res: Response) => {
            const start   = Date.now();
            const context = extractContext(req);
            const body    = req.body as RunRequest;

            if (!body?.capability) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "Missing 'capability' field"));
            }

            const handler = this.handlers.get(body.capability);
            if (!handler) {
                return res.status(404).json(
                    this.errEnvelope('CAPABILITY_NOT_FOUND', `Capability '${body.capability}' not found`)
                );
            }
            if (this.draining) {
                return res.status(503).json(this.errEnvelope('AGENT_UNAVAILABLE', 'The agent is draining: it is not accepting new runs'));
            }

            const gated = await this.passGate(req, body.capability, (body.input ?? {}) as Record<string, unknown>, context);
            if (!gated.ok) return res.status(gated.status).json(this.errEnvelope(gated.code, gated.message, undefined, context.traceId));

            const runAsync = body.async ?? handler.definition.async;
            // What the handler reports as spent. Only finite, non-negative amounts count; none reported stays undefined.
            let cost: number | undefined;
            const runContext: AgentContext = {
                ...context,
                ...gated.context,
                reportCost: usd => { if (Number.isFinite(usd) && usd >= 0) cost = (cost ?? 0) + usd; },
            };

            if (!runAsync) {
                // Synchronous
                try {
                    const output = await handler.execute(body.input ?? {}, runContext);
                    await gated.finish?.({ ok: true });
                    res.json(this.okEnvelope(
                        { status: 'done', output, ...(cost !== undefined ? { costUsd: cost } : {}) },
                        { durationMs: Date.now() - start, traceId: context.traceId, agentVersion: this.info.version },
                    ));
                } catch (err) {
                    await gated.finish?.({ ok: false, error: (err as Error).message });
                    res.status(500).json(
                        this.errEnvelope('EXECUTION_FAILED', (err as Error).message, undefined, context.traceId)
                    );
                }
                return;
            }

            // Asynchronous — respond immediately, run in background
            const taskId = crypto.randomUUID();
            this.taskStore.create(taskId, body.capability);
            res.json(this.okEnvelope(
                { status: 'running', taskId },
                { traceId: context.traceId, agentVersion: this.info.version },
            ));

            setImmediate(async () => {
                this.taskStore.setRunning(taskId);
                try {
                    const output = await handler.execute(body.input ?? {}, runContext);
                    await gated.finish?.({ ok: true });
                    this.taskStore.complete(taskId, output, cost);
                } catch (err) {
                    await gated.finish?.({ ok: false, error: (err as Error).message });
                    this.taskStore.fail(taskId, (err as Error).message, cost);
                }
            });
        });

        this.app.get('/v1/agent/tasks/:id', this.runKey, (req: Request, res: Response) => {
            const task = this.taskStore.get(req.params.id);
            if (!task) {
                return res.status(404).json(this.errEnvelope('TASK_NOT_FOUND', `Task '${req.params.id}' not found`));
            }
            res.json(this.okEnvelope(task));
        });

        this.app.delete('/v1/agent/tasks/:id', this.runKey, (req: Request, res: Response) => {
            const task = this.taskStore.get(req.params.id);
            if (!task) {
                return res.status(404).json(this.errEnvelope('TASK_NOT_FOUND', `Task '${req.params.id}' not found`));
            }
            this.taskStore.cancel(req.params.id);
            res.json(this.okEnvelope({ taskId: req.params.id, status: 'cancelled' }));
        });

        // ── Control (protocol 1.1) ──────────────────────────────────────────────

        this.app.post('/v1/agent/control', this.controlKey, async (req: Request, res: Response) => {
            const body = req.body as { action?: unknown; params?: unknown } | undefined;
            const action = body?.action;
            if (typeof action !== 'string' || !(CONTROL_ACTIONS as readonly string[]).includes(action)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', `Unknown or missing 'action'. Expected one of: ${CONTROL_ACTIONS.join(', ')}`));
            }
            const params = body?.params ?? {};
            if (typeof params !== 'object' || params === null || Array.isArray(params)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'params' must be an object"));
            }
            const act = action as ControlAction;
            if (!this.controlActions().includes(act)) {
                return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', `This agent does not support '${act}'`));
            }
            const context = extractContext(req);
            try {
                // drain/resume are the server's own; a handler that also lists 'resume' (un-pause) is told too.
                if (act === 'drain') {
                    this.draining = true;
                    return res.json(this.okEnvelope({ action: act, draining: true }));
                }
                if (act === 'resume') this.draining = false;
                const result = this.control?.actions.includes(act)
                    ? await this.control.control(act, params as Record<string, unknown>, context)
                    : undefined;
                res.json(this.okEnvelope({ action: act, ...(act === 'resume' ? { draining: false } : {}), ...(result !== undefined ? { result } : {}) }));
            } catch (err) {
                this.sendControlError(res, err, context.traceId);
            }
        });

        this.app.get('/v1/agent/runs', this.controlKey, async (_req: Request, res: Response) => {
            try {
                const runs: RunSummary[] = this.control?.runs
                    ? await this.control.runs()
                    : this.taskStore.list().map(t => ({
                        runId: t.taskId, status: t.status, startedAt: t.startedAt,
                        ...(t.capability ? { capability: t.capability } : {}),
                        ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
                    }));
                res.json(this.okEnvelope({ runs, draining: this.draining }));
            } catch (err) {
                this.sendControlError(res, err);
            }
        });

        this.app.get('/v1/agent/audit', this.controlKey, async (req: Request, res: Response) => {
            if (!this.control?.audit) {
                return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent does not publish an audit trail'));
            }
            const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
            if (limitRaw !== undefined && (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 10_000)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'limit' must be an integer between 1 and 10000"));
            }
            const since = typeof req.query.since === 'string' ? req.query.since : undefined;
            if (since !== undefined && Number.isNaN(Date.parse(since))) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'since' must be an ISO timestamp"));
            }
            try {
                const entries = await this.control.audit({ ...(since ? { since } : {}), ...(limitRaw ? { limit: limitRaw } : {}) });
                res.json(this.okEnvelope({ entries }));
            } catch (err) {
                this.sendControlError(res, err);
            }
        });

        // ── Flows (protocol 1.1) ────────────────────────────────────────────────

        this.app.get('/v1/agent/flows', this.runKey, (_req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            res.json(this.okEnvelope({ flows: this.flowHandler.flows() }));
        });

        this.app.post('/v1/agent/flows/:name/runs', this.runKey, async (req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            if (this.draining) return res.status(503).json(this.errEnvelope('AGENT_UNAVAILABLE', 'The agent is draining: it is not accepting new runs'));
            const input = (req.body as { input?: unknown } | undefined)?.input ?? {};
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'input' must be an object"));
            }
            const context = extractContext(req);
            const gated = await this.passGate(req, `flow:${String(req.params.name)}`, input as Record<string, unknown>, context);
            if (!gated.ok) return res.status(gated.status).json(this.errEnvelope(gated.code, gated.message, undefined, context.traceId));
            try {
                // The flow runs on in the background: what the gate can record here is that it started.
                const started = await this.flowHandler.start(String(req.params.name), input as Record<string, unknown>, { ...context, ...gated.context });
                await gated.finish?.({ ok: true });
                res.json(this.okEnvelope(started));
            } catch (err) {
                await gated.finish?.({ ok: false, error: (err as Error).message });
                this.sendControlError(res, err, context.traceId);
            }
        });

        this.app.get('/v1/agent/flow-runs/:id', this.runKey, async (req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            try { res.json(this.okEnvelope(await this.flowHandler.status(String(req.params.id)))); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.post('/v1/agent/flow-runs/:id/:action', this.controlKey, async (req: Request, res: Response) => {
            const action = String(req.params.action) as FlowSteerAction;
            if (!(FLOW_STEER_ACTIONS as readonly string[]).includes(action)) {
                return res.status(404).json(this.errEnvelope('INVALID_INPUT', `Unknown flow action '${action}'`));
            }
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            try { res.json(this.okEnvelope(await this.flowHandler[action](String(req.params.id)))); }
            catch (err) { this.sendControlError(res, err); }
        });

        // ── Approvals (protocol 1.2) ────────────────────────────────────────────

        const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'executed'];
        const noApprovals = (res: Response) => res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent has no approvals'));

        this.app.get('/v1/agent/approvals', this.controlKey, async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            const status = typeof req.query.status === 'string' ? req.query.status : undefined;
            if (status !== undefined && !(APPROVAL_STATUSES as readonly string[]).includes(status)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'status' must be pending, approved, rejected or executed"));
            }
            try { res.json(this.okEnvelope({ approvals: await this.approvalHandler.list(status ? { status: status as ApprovalStatus } : {}) })); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.get('/v1/agent/approvals/:id', this.controlKey, async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            try { res.json(this.okEnvelope(await this.approvalHandler.get(String(req.params.id)))); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.post('/v1/agent/approvals/:id/decision', this.controlKey, async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            const b = req.body as Partial<ApprovalDecisionRequest> | undefined;
            if (b?.decision !== 'approve' && b?.decision !== 'reject') {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "Body needs 'decision' (approve | reject)"));
            }
            if (b.by !== undefined && !isApproverRef(b.by)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'by', when sent, must be { kind: human | agent | service, id }"));
            }
            if (b.reason !== undefined && typeof b.reason !== 'string') {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'reason' must be a string"));
            }
            // Who decides is what the server can tell, never what the body says: the control key alone is not a person.
            let by: ApproverRef | undefined = CONTROL_KEY_APPROVER;
            if (this.approverOf) {
                try {
                    by = await this.approverOf({ headers: req.headers });
                } catch (err) {
                    return res.status(403).json(this.errEnvelope('FORBIDDEN', `who approves could not be checked: ${(err as Error).message}`));
                }
                if (!isApproverRef(by)) {
                    return res.status(401).json(this.errEnvelope('UNAUTHORIZED', 'who approves could not be identified'));
                }
            }
            if (b.by !== undefined && (b.by.kind !== by!.kind || b.by.id !== by!.id)) {
                return res.status(403).json(this.errEnvelope('FORBIDDEN', `'by' says ${b.by.kind}:${b.by.id}, but the caller is ${by!.kind}:${by!.id}`));
            }
            const context = extractContext(req);
            try {
                const decision: ApprovalDecision = { decision: b.decision, by: { kind: by!.kind, id: by!.id }, ...(b.reason !== undefined ? { reason: b.reason } : {}) };
                res.json(this.okEnvelope(await this.approvalHandler.decide(String(req.params.id), decision, context)));
            } catch (err) { this.sendControlError(res, err, context.traceId); }
        });

        // 404 fallback
        this.app.use((req: Request, res: Response) => {
            res.status(404).json(this.errEnvelope(
                'CAPABILITY_NOT_FOUND',
                `Route not found: ${req.method} ${req.path}`,
            ));
        });

        // Error handler — body-parser failures (malformed JSON, payload too large) and
        // anything thrown outside a capability handler must still use the protocol envelope.
        this.app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
            if (res.headersSent) return next(err);
            const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
            if (status === 500) {
                return res.status(500).json(this.errEnvelope('EXECUTION_FAILED', err.message));
            }
            res.status(status).json(this.errEnvelope('INVALID_INPUT', err.message));
        });
    }

    /** The control actions this server accepts: its own drain/resume plus whatever the handler implements. */
    private controlActions(): ControlAction[] {
        return [...new Set<ControlAction>(['drain', 'resume', ...(this.control?.actions ?? [])])];
    }

    private sendControlError(res: Response, err: unknown, traceId?: string): void {
        // By name as well as by class: a handler from another package (agent-core's engine control) raises its own
        // error and must not need to import this one.
        const named = err as { name?: unknown; code?: unknown; message?: unknown; details?: unknown };
        if (err instanceof ControlError || (named?.name === 'ControlError' && typeof named.code === 'string')) {
            const e = named as { code: ErrorCode; message: string; details?: unknown };
            res.status(statusForCode(e.code)).json(this.errEnvelope(e.code, e.message, e.details, traceId));
            return;
        }
        res.status(500).json(this.errEnvelope('EXECUTION_FAILED', (err as Error).message, undefined, traceId));
    }

    // ── Envelope helpers ────────────────────────────────────────────────────

    private okEnvelope<T>(data: T, meta: ResponseMeta = {}): ProtocolResponse<T> {
        return { ok: true, data, error: null, meta: { agentVersion: this.info.version, ...meta } };
    }

    private errEnvelope(code: ErrorCode, message: string, details?: unknown, traceId?: string): ProtocolResponse<null> {
        return {
            ok:    false,
            data:  null,
            error: { code, message, ...(details ? { details } : {}) },
            meta:  { agentVersion: this.info.version, ...(traceId ? { traceId } : {}) },
        };
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    async start(): Promise<void> {
        if (!this.apiKey && !isLoopback(this.host)) {
            console.warn(`[agent-protocol] ${this.info.name} listens on ${this.host} without an apiKey: every capability is open to the network. Set apiKey (or strict: true to refuse this).`);
        }
        return new Promise(resolve => {
            this.server = this.app.listen(this.port, this.host, () => {
                console.log(`[agent-protocol] ${this.info.name}@${this.info.version} listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        clearInterval(this.evictTimer);
        return new Promise((resolve, reject) => {
            if (!this.server) return resolve();
            this.server.close(err => (err ? reject(err) : resolve()));
        });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractContext(req: Request): AgentContext {
    return {
        tenantId:  req.headers['x-tenant-id']  as string | undefined,
        traceId:   req.headers['x-trace-id']   as string | undefined,
        requestId: req.headers['x-request-id'] as string | undefined,
    };
}
