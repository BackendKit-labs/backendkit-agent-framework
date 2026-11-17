import express, { Express, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
    CONTROL_ACTIONS,
    PROTOCOL_MINOR,
    type AgentInfo,
    type CapabilityDefinition,
    type AgentContext,
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
import type { ApprovalDecision, ApprovalStatus } from '../types';
import { FLOW_STEER_ACTIONS, type FlowSteerAction } from '../types';
import { TaskStore } from './TaskStore';

const CONTROL_PATHS = new Set(['/v1/agent/control', '/v1/agent/runs', '/v1/agent/audit']);
/** Pausing, resuming and cancelling a flow run are control: they need the control key. */
/** Approvals carry the input and output of steps: all of them (list, read, decide) need the control key. */
const APPROVALS_PATH = /^\/v1\/agent\/approvals(\/.*)?$/;
const FLOW_STEER_PATH = /^\/v1\/agent\/flow-runs\/[^/]+\/(pause|resume|cancel)$/;

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
}

const isLoopback = (host: string): boolean => host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');

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

    // ── Middleware ──────────────────────────────────────────────────────────

    private setupMiddleware(): void {
        this.app.use(express.json({ limit: '10mb' }));

        // Auth. Control endpoints need the control key and nothing else opens them.
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            if (CONTROL_PATHS.has(req.path) || (req.method === 'POST' && FLOW_STEER_PATH.test(req.path)) || APPROVALS_PATH.test(req.path)) {
                if (!this.controlApiKey) {
                    return res.status(403).json(this.errEnvelope('FORBIDDEN', 'Control endpoints are disabled: no controlApiKey is configured'));
                }
                if (!keyMatches(req.headers.authorization, this.controlApiKey)) {
                    return res.status(401).json(this.errEnvelope('UNAUTHORIZED', 'Invalid or missing control key'));
                }
                return next();
            }
            if (req.path === '/v1/agent/health') return next();
            if (!this.apiKey) return next();
            const auth = req.headers.authorization;
            if (!keyMatches(auth, this.apiKey)) {
                return res.status(401).json(this.errEnvelope('UNAUTHORIZED', 'Invalid or missing API key'));
            }
            next();
        });
    }

    // ── Routes ──────────────────────────────────────────────────────────────

    private setupRoutes(): void {
        this.app.get('/v1/agent/health', (_req, res) => {
            res.json(this.okEnvelope({ status: 'ok' }));
        });

        this.app.get('/v1/agent/info', (_req, res) => {
            res.json(this.okEnvelope(this.info, { agentVersion: this.info.version }));
        });

        this.app.post('/v1/agent/run', async (req: Request, res: Response) => {
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

            const runAsync = body.async ?? handler.definition.async;
            // What the handler reports as spent. Only finite, non-negative amounts count; none reported stays undefined.
            let cost: number | undefined;
            const runContext: AgentContext = {
                ...context,
                reportCost: usd => { if (Number.isFinite(usd) && usd >= 0) cost = (cost ?? 0) + usd; },
            };

            if (!runAsync) {
                // Synchronous
                try {
                    const output = await handler.execute(body.input ?? {}, runContext);
                    res.json(this.okEnvelope(
                        { status: 'done', output, ...(cost !== undefined ? { costUsd: cost } : {}) },
                        { durationMs: Date.now() - start, traceId: context.traceId, agentVersion: this.info.version },
                    ));
                } catch (err) {
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
                    this.taskStore.complete(taskId, output, cost);
                } catch (err) {
                    this.taskStore.fail(taskId, (err as Error).message, cost);
                }
            });
        });

        this.app.get('/v1/agent/tasks/:id', (req: Request, res: Response) => {
            const task = this.taskStore.get(req.params.id);
            if (!task) {
                return res.status(404).json(this.errEnvelope('TASK_NOT_FOUND', `Task '${req.params.id}' not found`));
            }
            res.json(this.okEnvelope(task));
        });

        this.app.delete('/v1/agent/tasks/:id', (req: Request, res: Response) => {
            const task = this.taskStore.get(req.params.id);
            if (!task) {
                return res.status(404).json(this.errEnvelope('TASK_NOT_FOUND', `Task '${req.params.id}' not found`));
            }
            this.taskStore.cancel(req.params.id);
            res.json(this.okEnvelope({ taskId: req.params.id, status: 'cancelled' }));
        });

        // ── Control (protocol 1.1) ──────────────────────────────────────────────

        this.app.post('/v1/agent/control', async (req: Request, res: Response) => {
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

        this.app.get('/v1/agent/runs', async (_req: Request, res: Response) => {
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

        this.app.get('/v1/agent/audit', async (req: Request, res: Response) => {
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

        this.app.get('/v1/agent/flows', (_req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            res.json(this.okEnvelope({ flows: this.flowHandler.flows() }));
        });

        this.app.post('/v1/agent/flows/:name/runs', async (req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            if (this.draining) return res.status(503).json(this.errEnvelope('AGENT_UNAVAILABLE', 'The agent is draining: it is not accepting new runs'));
            const input = (req.body as { input?: unknown } | undefined)?.input ?? {};
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'input' must be an object"));
            }
            const context = extractContext(req);
            try {
                res.json(this.okEnvelope(await this.flowHandler.start(String(req.params.name), input as Record<string, unknown>, context)));
            } catch (err) { this.sendControlError(res, err, context.traceId); }
        });

        this.app.get('/v1/agent/flow-runs/:id', async (req: Request, res: Response) => {
            if (!this.flowHandler) return res.status(501).json(this.errEnvelope('CONTROL_UNSUPPORTED', 'This agent hosts no flows'));
            try { res.json(this.okEnvelope(await this.flowHandler.status(String(req.params.id)))); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.post('/v1/agent/flow-runs/:id/:action', async (req: Request, res: Response) => {
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

        this.app.get('/v1/agent/approvals', async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            const status = typeof req.query.status === 'string' ? req.query.status : undefined;
            if (status !== undefined && !(APPROVAL_STATUSES as readonly string[]).includes(status)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'status' must be pending, approved, rejected or executed"));
            }
            try { res.json(this.okEnvelope({ approvals: await this.approvalHandler.list(status ? { status: status as ApprovalStatus } : {}) })); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.get('/v1/agent/approvals/:id', async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            try { res.json(this.okEnvelope(await this.approvalHandler.get(String(req.params.id)))); }
            catch (err) { this.sendControlError(res, err); }
        });

        this.app.post('/v1/agent/approvals/:id/decision', async (req: Request, res: Response) => {
            if (!this.approvalHandler) return noApprovals(res);
            const b = req.body as Partial<ApprovalDecision> | undefined;
            const by = b?.by;
            if ((b?.decision !== 'approve' && b?.decision !== 'reject')
                || !by || typeof by.id !== 'string' || !by.id || !['human', 'agent', 'service'].includes(by.kind)) {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "Body needs 'decision' (approve | reject) and 'by' ({ kind: human | agent | service, id })"));
            }
            if (b.reason !== undefined && typeof b.reason !== 'string') {
                return res.status(400).json(this.errEnvelope('INVALID_INPUT', "'reason' must be a string"));
            }
            const context = extractContext(req);
            try {
                const decision: ApprovalDecision = { decision: b.decision, by: { kind: by.kind, id: by.id }, ...(b.reason !== undefined ? { reason: b.reason } : {}) };
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
