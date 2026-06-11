import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SessionManager } from '../session/SessionManager';
import type { SessionManagerOptions } from '../session/SessionManager';
import { MonitorBus } from '../monitor/MonitorBus';
import { MetricsCollector } from '../metrics/MetricsCollector';
import type { MetricsCollectorOptions } from '../metrics/MetricsCollector';
import type { SessionMetaStore } from '../store/SessionMetaStore';
import type { TriggerBus } from '../trigger/TriggerBus';
import { registerRoutes } from './routes';

export type AuthHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface RateLimitOptions {
    /** Max requests per IP per time window. Default: 100. */
    max?: number;
    /** Time window string (e.g. '1 minute', '30 seconds'). Default: '1 minute'. */
    timeWindow?: string;
}

export interface MetricsOptions extends MetricsCollectorOptions {
    /** Enable Prometheus /metrics endpoint. Default: false. */
    enabled: boolean;
    /** Path for the metrics endpoint. Default: '/metrics'. */
    path?: string;
}

export interface AgentServerOptions extends Omit<SessionManagerOptions, 'metrics' | 'store'> {
    /** TCP port to listen on. Default: 3000. */
    port?: number;
    /** Host to bind to. Default: '0.0.0.0'. */
    host?: string;
    /** Optional auth hook — called on every request before route handlers. */
    auth?: AuthHook;
    /** Fastify logger. Default: false (silent). Pass true for pretty logs in dev. */
    logger?: boolean | object;
    /** Allowed CORS origins. Default: '*'. */
    cors?: string | string[];
    /**
     * Rate limiting per IP.  Requires @fastify/rate-limit to be installed.
     * @example { max: 60, timeWindow: '1 minute' }
     */
    rateLimiting?: RateLimitOptions;
    /**
     * Prometheus metrics.  Requires prom-client to be installed.
     * @example { enabled: true, path: '/metrics' }
     */
    metrics?: MetricsOptions;
    /**
     * Durable store for session metadata (Redis, etc.).
     * Default: in-memory (no persistence).
     */
    store?: SessionMetaStore;
    /**
     * Optional TriggerBus — registers webhook routes on this server and
     * starts cron jobs when start() is called.
     * @example
     * ```ts
     * const triggers = new TriggerBus(engineFactory)
     *   .addCron({ schedule: '0 9 * * 1-5', name: 'report', buildPrompt: () => '...' });
     * new AgentServer({ triggers, ... });
     * ```
     */
    triggers?: TriggerBus;
}

export class AgentServer {
    private app: FastifyInstance;
    private sessions: SessionManager;
    private readonly monitor: MonitorBus;
    private readonly collector: MetricsCollector | undefined;
    private readonly triggerBus: TriggerBus | undefined;
    private readonly _port: number;
    private readonly host: string;

    constructor(opts: AgentServerOptions) {
        this._port = opts.port ?? 3000;
        this.host = opts.host ?? '0.0.0.0';

        this.monitor = new MonitorBus();
        this.triggerBus = opts.triggers;

        this.collector = opts.metrics?.enabled
            ? new MetricsCollector({ prefix: opts.metrics.prefix, collectNodeMetrics: opts.metrics.collectNodeMetrics })
            : undefined;

        this.sessions = new SessionManager({
            engineFactory: opts.engineFactory,
            maxIdleMs: opts.maxIdleMs,
            maxSessions: opts.maxSessions,
            monitorBus: this.monitor,
            metrics: this.collector,
            store: opts.store,
        });

        this.app = Fastify({ logger: opts.logger ?? false });

        // CORS headers
        const origins = opts.cors ?? '*';
        this.app.addHook('onSend', async (_req, reply) => {
            const origin = Array.isArray(origins) ? origins.join(', ') : origins;
            reply.header('Access-Control-Allow-Origin', origin);
        });
        this.app.options('*', async (_req, reply) => {
            const origin = Array.isArray(origins) ? origins.join(', ') : origins;
            reply.header('Access-Control-Allow-Origin', origin);
            reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            reply.code(204).send();
        });

        // Rate limiting (optional dep)
        if (opts.rateLimiting) {
            const rl = opts.rateLimiting;
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const rateLimitPlugin = require('@fastify/rate-limit');
                void this.app.register(rateLimitPlugin, {
                    max: rl.max ?? 100,
                    timeWindow: rl.timeWindow ?? '1 minute',
                });
            } catch {
                console.warn('[agent-web] @fastify/rate-limit not found — rate limiting disabled. Run: npm i @fastify/rate-limit');
            }
        }

        if (opts.auth) {
            const authHook = opts.auth;
            this.app.addHook('preHandler', authHook);
        }

        // Register websocket plugin + all routes inside a register() so Fastify
        // resolves the plugin before wiring routes (required for WS routes in v11).
        const sessions = this.sessions;
        const monitor = this.monitor;
        const collector = this.collector;
        const metricsPath = opts.metrics?.path;
        const triggers = this.triggerBus;
        this.app.register(async (instance) => {
            await instance.register(fastifyWebSocket);
            registerRoutes(instance, sessions, monitor, collector, metricsPath);
            triggers?.registerRoutes(instance);
        });
    }

    async start(): Promise<string> {
        this.triggerBus?.start();
        const address = await this.app.listen({ port: this._port, host: this.host });
        return address;
    }

    async stop(): Promise<void> {
        await this.triggerBus?.close();
        this.sessions.close();
        await this.app.close();
    }

    get port(): number {
        return this._port;
    }

    get sessionManager(): SessionManager {
        return this.sessions;
    }

    get monitorBus(): MonitorBus {
        return this.monitor;
    }
}
