import express, { Express, Request, Response, NextFunction } from 'express';
import type {
    AgentInfo,
    CapabilityDefinition,
    AgentContext,
    RunRequest,
    ProtocolResponse,
    ErrorCode,
    ResponseMeta,
} from '../types';
import { TaskStore } from './TaskStore';

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
}

export class AgentServer {
    private readonly app:        Express;
    private readonly taskStore:  TaskStore;
    private readonly handlers:   Map<string, CapabilityHandler>;
    private readonly info:       AgentInfo;
    private readonly port:       number;
    private readonly apiKey?:    string;
    private server:              ReturnType<Express['listen']> | null = null;
    private evictTimer?:         ReturnType<typeof setInterval>;

    constructor(opts: AgentServerOptions) {
        this.port      = opts.port ?? 3300;
        this.apiKey    = opts.apiKey;
        this.taskStore = new TaskStore();
        this.handlers  = new Map();
        this.info      = { name: opts.name, version: opts.version, description: opts.description, capabilities: [] };
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

        // Auth
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.path === '/v1/agent/health') return next();
            if (!this.apiKey) return next();
            const auth = req.headers.authorization;
            if (!auth?.startsWith('Bearer ') || auth.slice(7) !== this.apiKey) {
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
            this.taskStore.create(taskId);
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

        // 404 fallback
        this.app.use((req: Request, res: Response) => {
            res.status(404).json(this.errEnvelope(
                'CAPABILITY_NOT_FOUND',
                `Route not found: ${req.method} ${req.path}`,
            ));
        });
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
