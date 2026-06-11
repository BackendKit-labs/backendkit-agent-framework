import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AgentEngine, AgentEvent, Transport } from '@backendkit-labs/agent-core';
import { HeadlessTransport } from '../transport/HeadlessTransport';
import type { MonitorBus } from '../monitor/MonitorBus';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Engine factory signature compatible with TriggerBus (and createEnterpriseSetup).
 * Uses the base Transport interface so HeadlessTransport can be passed.
 */
export type TriggerEngineFactory = (sessionId: string, transport: Transport) => AgentEngine;

export interface TriggerResult {
    sessionId:   string;
    triggerName: string;
    firedAt:     Date;
    durationMs:  number;
    output:      string;
    events:      AgentEvent[];
}

export interface TriggerDefinition {
    /** Human-readable name — shown in logs and MonitorBus. */
    name: string;
    /**
     * Build the agent prompt from the trigger payload.
     * For cron triggers payload is undefined; for webhooks it's the parsed body.
     */
    buildPrompt: (payload?: unknown) => string | Promise<string>;
    /** Called after a successful run. */
    onComplete?: (result: TriggerResult) => void | Promise<void>;
    /** Called when the run throws. */
    onError?: (err: Error, triggerName: string) => void | Promise<void>;
}

export interface CronTriggerDef extends TriggerDefinition {
    /** Standard 5-field cron expression (e.g. '0 9 * * 1-5'). */
    schedule: string;
    /** If true, fire once immediately when TriggerBus.start() is called. */
    runOnStart?: boolean;
}

export interface WebhookTriggerDef extends TriggerDefinition {
    /**
     * Fastify route path (e.g. '/triggers/github').
     * Must start with '/'.
     */
    path: string;
    /** HTTP method accepted. Default: 'POST'. */
    method?: 'GET' | 'POST' | 'PUT';
    /**
     * Optional HMAC secret.  When set, validates the incoming request against
     * X-Hub-Signature-256 (GitHub-compatible) before firing the trigger.
     */
    secret?: string;
}

// ── TriggerBus ────────────────────────────────────────────────────────────────

/**
 * Orchestrates autonomous agent runs triggered by cron schedules or
 * inbound HTTP webhooks.
 *
 * Integrates with AgentServer via the `triggers` option so webhook routes
 * are registered on the same Fastify instance and cron jobs start alongside
 * the server.  Can also be used standalone (no AgentServer required).
 *
 * All runs are broadcast to the MonitorBus (if supplied) so the kanban board
 * shows autonomous runs alongside interactive chat sessions.
 *
 * Usage:
 * ```ts
 * const triggers = new TriggerBus(enterprise.engineFactory)
 *   .addCron({
 *     name:        'daily-report',
 *     schedule:    '0 9 * * 1-5',
 *     buildPrompt: () => 'Generate the daily ops summary.',
 *     onComplete:  ({ output }) => console.log(output),
 *   })
 *   .addWebhook({
 *     name:        'github-issue',
 *     path:        '/triggers/github',
 *     secret:      process.env.GITHUB_WEBHOOK_SECRET,
 *     buildPrompt: (body) => `New GitHub issue: ${JSON.stringify(body)}`,
 *   });
 *
 * const server = new AgentServer({ port: 4001, engineFactory, triggers });
 * await server.start();
 * ```
 */
export class TriggerBus {
    private readonly cronDefs:    CronTriggerDef[]    = [];
    private readonly webhookDefs: WebhookTriggerDef[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private cronTasks: any[] = [];  // node-cron ScheduledTask — loaded lazily
    private started = false;

    constructor(
        private readonly engineFactory: TriggerEngineFactory,
        private readonly monitorBus?: MonitorBus,
    ) {}

    addCron(def: CronTriggerDef): this {
        this.cronDefs.push(def);
        return this;
    }

    addWebhook(def: WebhookTriggerDef): this {
        this.webhookDefs.push(def);
        return this;
    }

    // ── Fastify integration ───────────────────────────────────────────────────

    /** Register webhook routes on a Fastify instance. Called by AgentServer. */
    registerRoutes(app: FastifyInstance): void {
        for (const def of this.webhookDefs) {
            const method = (def.method ?? 'POST').toLowerCase() as 'get' | 'post' | 'put';
            app[method](def.path, async (req: FastifyRequest, reply: FastifyReply) => {
                if (def.secret) {
                    const sig = (req.headers['x-hub-signature-256'] ?? '') as string;
                    const rawBody = JSON.stringify(req.body);
                    if (!verifyHmac(rawBody, sig, def.secret)) {
                        return reply.code(401).send({ error: 'Invalid webhook signature' });
                    }
                }
                // Fire async — respond immediately so the caller doesn't time out
                void this.fire(def, req.body).catch(err =>
                    def.onError?.(err instanceof Error ? err : new Error(String(err)), def.name),
                );
                return reply.code(202).send({ queued: true, trigger: def.name });
            });
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        if (this.started) return;
        this.started = true;
        this.startCrons();
    }

    close(): void {
        for (const task of this.cronTasks) {
            try { task.stop(); } catch { /* already stopped */ }
        }
        this.cronTasks = [];
        this.started = false;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private startCrons(): void {
        let nodeCron: typeof import('node-cron') | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            nodeCron = require('node-cron') as typeof import('node-cron');
        } catch {
            if (this.cronDefs.length > 0) {
                console.warn('[TriggerBus] node-cron not found — cron triggers disabled. Run: npm i node-cron');
            }
            return;
        }

        for (const def of this.cronDefs) {
            if (!nodeCron.validate(def.schedule)) {
                console.error(`[TriggerBus] Invalid cron schedule for "${def.name}": ${def.schedule}`);
                continue;
            }
            const task = nodeCron.schedule(def.schedule, () => {
                void this.fire(def).catch(err =>
                    def.onError?.(err instanceof Error ? err : new Error(String(err)), def.name),
                );
            });

            this.cronTasks.push(task);

            if (def.runOnStart) {
                void this.fire(def).catch(err =>
                    def.onError?.(err instanceof Error ? err : new Error(String(err)), def.name),
                );
            }
        }
    }

    private async fire(def: TriggerDefinition, payload?: unknown): Promise<void> {
        const sessionId = `trigger-${uuidv4()}`;
        const firedAt   = new Date();
        const startMs   = Date.now();

        const transport = new HeadlessTransport();

        // Fan out to MonitorBus so the kanban shows autonomous runs
        if (this.monitorBus) {
            const bus = this.monitorBus;
            const origEmit = transport.emit.bind(transport);
            transport.emit = (event: AgentEvent) => {
                origEmit(event);
                bus.broadcast(sessionId, event);
            };
            bus.notifySessionOpen(sessionId);
        }

        try {
            const engine = this.engineFactory(sessionId, transport);
            const prompt  = await def.buildPrompt(payload);

            await engine.run(prompt);

            const result: TriggerResult = {
                sessionId,
                triggerName: def.name,
                firedAt,
                durationMs:  Date.now() - startMs,
                output:      transport.getOutput(),
                events:      transport.getEvents(),
            };

            await def.onComplete?.(result);
        } finally {
            this.monitorBus?.notifySessionClose(sessionId);
            transport.close();
        }
    }
}

// ── HMAC helper ───────────────────────────────────────────────────────────────

function verifyHmac(body: string, signature: string, secret: string): boolean {
    if (!signature) return false;
    const expected = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex')}`;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'utf8'),
            Buffer.from(expected, 'utf8'),
        );
    } catch {
        return false;
    }
}
