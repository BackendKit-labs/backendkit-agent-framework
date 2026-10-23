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
import { TaskStore } from './TaskStore';

const CONTROL_PATHS = new Set(['/v1/agent/control', '/v1/agent/runs', '/v1/agent/audit']);

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
    apiKey?:     string;
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
}

export class AgentServer {
    private readonly app:        Express;
    private readonly taskStore:  TaskStore;
    private readonly handlers:   Map<string, CapabilityHandler>;
    private readonly info:       AgentInfo;
    private readonly port:       number;
    private readonly apiKey?:    string;
    private readonly controlApiKey?: string;
    private readonly control?:   ControlHandler;
    private draining = false;
    private server:              ReturnType<Express['listen']> | null = null;
    private evictTimer?:         ReturnType<typeof setInterval>;

    constructor(opts: AgentServerOptions) {
        this.port      = opts.port ?? 3300;
        this.apiKey    = opts.apiKey;
        this.controlApiKey = opts.controlApiKey;
        this.control   = opts.control;
        this.taskStore = new TaskStore();
        this.handlers  = new Map();
        this.info      = {
            name: opts.name, version: opts.version, description: opts.description, capabilities: [],
            protocolMinor: PROTOCOL_MINOR,
            ...(opts.limits ? { limits: opts.limits } : {}),
            ...(opts.flows ? { flows: opts.flows } : {}),
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
            if (CONTROL_PATHS.has(req.path)) {
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

            if (!runAsync) {
                // Synchronous
                try {
                    const output = await handler.execute(body.input ?? {}, context);
                    res.json(this.okEnvelope(
                        { status: 'done', output },
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
                    const output = await handler.execute(body.input ?? {}, context);
                    this.taskStore.complete(taskId, output);
                } catch (err) {
                    this.taskStore.fail(taskId, (err as Error).message);
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
        return new Promise(resolve => {
            this.server = this.app.listen(this.port, () => {
                console.log(`[agent-protocol] ${this.info.name}@${this.info.version} listening on :${this.port}`);
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
