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
import { isLoopbackRequest } from '@backendkit-labs/agent-core';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

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
    /** Host to bind to. Default: '127.0.0.1'; use '0.0.0.0' (with `auth`) to accept remote callers. */
    host?: string;
    /** Optional auth hook — called on every request before route handlers. */
    auth?: AuthHook;
    /**
     * With an auth hook that sets `req.user` (as JwtAuth does), `/sessions` and `/monitor` show a user only the
     * sessions it owns, and it can end only those. A user holding this role in `roles` sees and ends all of them.
     * Without auth, or with a hook that leaves `req.user` unset, the server is single-tenant and nothing is filtered.
     * Default: 'admin'.
     */
    adminRole?: string;
    /** Turns a session may have queued or running; a message past that gets an error. Default: 4. */
    maxPendingInputs?: number;
    /** Largest WebSocket message, in bytes. Default: 1 MiB. */
    maxMessageBytes?: number;
    /** Send the message of an engine error to the client. Default false: the client gets a generic one and the detail goes to the server's log. */
    exposeErrors?: boolean;
    /** Fastify logger. Default: false (silent). Pass true for pretty logs in dev. */
    logger?: boolean | object;
    /** Allowed CORS origins. Default: '*', or none when `strict` is set. */
    cors?: string | string[];
    /**
     * Fail-closed defaults for a server that other people reach:
     *  - no CORS origin is allowed unless `cors` lists it (default without `strict`: '*');
     *  - responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`;
     *  - the constructor throws when the server listens on a non-loopback `host` without an `auth` hook.
     * Pair it with `JwtAuth({ allowQueryToken: false })`. Default: false.
     */
    strict?: boolean;
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
        this.host = opts.host ?? '127.0.0.1';
        if (opts.strict && !opts.auth && !['127.0.0.1', 'localhost', '::1'].includes(this.host)) {
            throw new Error(`AgentServer: strict mode refuses to listen on "${this.host}" without an auth hook.`);
        }

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

        // CORS headers. The header carries one origin or '*', never a list: a list is matched against the
        // request's Origin and that origin is echoed back; an origin that is not listed gets no header.
        const origins = opts.cors ?? (opts.strict ? [] : '*');
        const allowOrigin = (requestOrigin: string | undefined): string | undefined => {
            if (!Array.isArray(origins)) return origins;
            if (origins.includes('*')) return '*';
            return requestOrigin && origins.includes(requestOrigin) ? requestOrigin : undefined;
        };
        const setAllowOrigin = (req: { headers: { origin?: string } }, reply: { header(name: string, value: string): unknown }): void => {
            const origin = allowOrigin(req.headers.origin);
            if (origin) reply.header('Access-Control-Allow-Origin', origin);
            if (Array.isArray(origins)) reply.header('Vary', 'Origin');
        };
        this.app.addHook('onSend', async (req, reply) => {
            setAllowOrigin(req, reply);
            if (opts.strict) {
                reply.header('X-Content-Type-Options', 'nosniff');
                reply.header('X-Frame-Options', 'DENY');
                reply.header('Referrer-Policy', 'no-referrer');
            }
        });
        this.app.options('*', async (req, reply) => {
            setAllowOrigin(req, reply);
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

        // A server with no `auth` on loopback is still reachable from a web page in the user's browser: the handshake of a WebSocket is
        // not subject to CORS, and a rebinding DNS name points at 127.0.0.1. Without a token, a request has to come from loopback
        // (its Host and its Origin) or from an origin the operator listed in `cors`. Webhook routes are exempt: they carry an HMAC.
        const listed = Array.isArray(opts.cors) ? opts.cors : (typeof opts.cors === 'string' && opts.cors !== '*' ? [opts.cors] : []);
        const loopbackBind = LOOPBACK_HOSTS.includes(this.host);
        // preHandler, like the auth hook: a refusal sent from onRequest leaves the socket of a WebSocket upgrade open and close() waits for it.
        this.app.addHook('preHandler', async (req, reply) => {
            if (this.triggerBus?.isWebhookRoute(req.method, req.url)) return;
            const origin = req.headers.origin;
            if (origin !== undefined && listed.includes(origin)) return;
            if (opts.auth) {
                // A token is required, and a foreign page has none. An explicit list of origins is still enforced on a WebSocket upgrade.
                const upgrade = String(req.headers.upgrade ?? '').toLowerCase() === 'websocket';
                if (upgrade && origin !== undefined && Array.isArray(opts.cors) && !opts.cors.includes('*')) {
                    return reply.code(403).send({ error: 'Forbidden origin' });
                }
                return;
            }
            if (loopbackBind && !isLoopbackRequest(req.headers.host, origin)) {
                return reply.code(403).send({ error: 'Forbidden host or origin' });
            }
        });

        if (opts.auth) {
            const authHook = opts.auth;
            const triggerBus = this.triggerBus;
            this.app.addHook('preHandler', async (req, reply) => {
                if (triggerBus?.isWebhookRoute(req.method, req.url)) return;      // signed with an HMAC, not with a JWT
                return authHook(req, reply);
            });
        }

        // Register websocket plugin + all routes inside a register() so Fastify
        // resolves the plugin before wiring routes (required for WS routes in v11).
        const sessions = this.sessions;
        const monitor = this.monitor;
        const collector = this.collector;
        const metricsPath = opts.metrics?.path;
        const triggers = this.triggerBus;
        this.app.register(async (instance) => {
            // A browser that offers the subprotocols `bearer, <jwt>` needs the server to select one of them,
            // or it drops the connection. Select `bearer`, never the token.
            await instance.register(fastifyWebSocket, {
                options: {
                    handleProtocols: (protocols: Set<string>) => (protocols.has('bearer') ? 'bearer' : false),
                    maxPayload: opts.maxMessageBytes ?? 1_048_576,
                },
            });
            registerRoutes(instance, sessions, monitor, collector, metricsPath, opts.adminRole, {
                maxPendingInputs: opts.maxPendingInputs ?? 4,
                exposeErrors: opts.exposeErrors ?? false,
            });
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
