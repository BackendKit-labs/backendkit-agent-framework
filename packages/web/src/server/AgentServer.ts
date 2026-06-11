import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SessionManager } from '../session/SessionManager';
import type { SessionManagerOptions } from '../session/SessionManager';
import { MonitorBus } from '../monitor/MonitorBus';
import { registerRoutes } from './routes';

export type AuthHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface AgentServerOptions extends SessionManagerOptions {
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
}

export class AgentServer {
    private app: FastifyInstance;
    private sessions: SessionManager;
    private readonly monitor: MonitorBus;
    private readonly port: number;
    private readonly host: string;

    constructor(opts: AgentServerOptions) {
        this.port = opts.port ?? 3000;
        this.host = opts.host ?? '0.0.0.0';

        this.monitor = new MonitorBus();

        this.sessions = new SessionManager({
            engineFactory: opts.engineFactory,
            maxIdleMs: opts.maxIdleMs,
            maxSessions: opts.maxSessions,
            monitorBus: this.monitor,
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

        if (opts.auth) {
            const authHook = opts.auth;
            this.app.addHook('preHandler', authHook);
        }

        // Register websocket plugin + all routes inside a register() so Fastify
        // resolves the plugin before wiring routes (required for WS routes in v11).
        const sessions = this.sessions;
        const monitor = this.monitor;
        this.app.register(async (instance) => {
            await instance.register(fastifyWebSocket);
            registerRoutes(instance, sessions, monitor);
        });
    }

    async start(): Promise<string> {
        const address = await this.app.listen({ port: this.port, host: this.host });
        return address;
    }

    async stop(): Promise<void> {
        this.sessions.close();
        await this.app.close();
    }

    get sessionManager(): SessionManager {
        return this.sessions;
    }

    get monitorBus(): MonitorBus {
        return this.monitor;
    }
}
