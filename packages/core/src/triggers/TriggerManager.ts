import type { ScheduledTask } from 'node-cron';
import type { AgentEngine } from '../engine/AgentEngine';
import type { Transport } from '../transport/Transport';
import { WebhookServer } from './WebhookServer';
import { EventBus } from './EventBus';
import type {
    TriggerConfig,
    ScheduleTriggerConfig,
    WebhookTriggerConfig,
    EventTriggerConfig,
} from './types';

/**
 * Manages all trigger listeners for an autonomous agent.
 * Serializes concurrent trigger fires — if the agent is busy, incoming
 * triggers are dropped with a warning (v1 behaviour; a queue can be added later).
 */
export class TriggerManager {
    private scheduledTasks: ScheduledTask[] = [];
    private webhookServer: WebhookServer | null = null;
    private eventUnsubscribers: Array<() => void> = [];
    private busy = false;

    constructor(
        private readonly engine: AgentEngine,
        private readonly triggers: TriggerConfig[],
        private readonly webhookPort: number,
        private readonly transport: Transport,
    ) {}

    async start(): Promise<void> {
        const webhookTriggers: WebhookTriggerConfig[] = [];

        for (const trigger of this.triggers) {
            if (trigger.type === 'schedule') await this.setupSchedule(trigger);
            if (trigger.type === 'webhook') webhookTriggers.push(trigger);
            if (trigger.type === 'event') this.setupEvent(trigger);
        }

        if (webhookTriggers.length > 0) {
            this.webhookServer = new WebhookServer(this.webhookPort);
            for (const t of webhookTriggers) this.setupWebhook(t);
            await this.webhookServer.start();
            this.transport.emit({
                type: 'system', level: 'info',
                text: `[Triggers] Webhook server listening on :${this.webhookPort}`,
            });
        }
    }

    async stop(): Promise<void> {
        for (const task of this.scheduledTasks) task.stop();
        this.scheduledTasks = [];

        for (const unsub of this.eventUnsubscribers) unsub();
        this.eventUnsubscribers = [];

        if (this.webhookServer) {
            await this.webhookServer.stop();
            this.webhookServer = null;
        }
    }

    /** Fire an event on the shared EventBus (activates matching event triggers). */
    emit(topic: string, data: unknown, source?: string): void {
        EventBus.emit(topic, { source, data });
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async setupSchedule(cfg: ScheduleTriggerConfig): Promise<void> {
        let cron: typeof import('node-cron');
        try {
            cron = await import('node-cron');
        } catch {
            throw new Error('Schedule triggers require "node-cron". Run: npm install node-cron');
        }

        if (!cron.validate(cfg.cron)) {
            throw new Error(`Invalid cron expression: "${cfg.cron}"`);
        }

        const task = cron.schedule(cfg.cron, () => {
            void this.safeRun(cfg.task, `schedule(${cfg.cron})`);
        }, {
            timezone: cfg.timezone,
        });

        this.scheduledTasks.push(task);
    }

    private setupWebhook(cfg: WebhookTriggerConfig): void {
        this.webhookServer!.register(cfg.path, (body, headers) => {
            const prompt = cfg.buildPrompt
                ? cfg.buildPrompt(body, headers)
                : `Webhook received at ${cfg.path}:\n${JSON.stringify(body, null, 2)}`;
            void this.safeRun(prompt, `webhook(${cfg.path})`);
        }, cfg.secret, { allowUnsigned: cfg.allowUnsigned });
    }

    private setupEvent(cfg: EventTriggerConfig): void {
        const unsub = EventBus.on(cfg.topic, (payload) => {
            if (cfg.source && payload.source !== cfg.source) return;

            const prompt = cfg.buildPrompt
                ? cfg.buildPrompt(payload.data)
                : `Event "${cfg.topic}"${payload.source ? ` from ${payload.source}` : ''}:\n${JSON.stringify(payload.data, null, 2)}`;
            void this.safeRun(prompt, `event(${cfg.topic})`);
        });
        this.eventUnsubscribers.push(unsub);
    }

    private async safeRun(prompt: string, source: string): Promise<void> {
        if (this.busy) {
            this.transport.emit({
                type: 'system', level: 'warn',
                text: `[Triggers] Agent busy — dropped trigger from ${source}`,
            });
            return;
        }
        this.busy = true;
        try {
            await this.engine.run(prompt);
        } catch (err) {
            this.transport.emit({
                type: 'error',
                message: `Trigger "${source}" failed: ${(err as Error).message}`,
            });
        } finally {
            this.busy = false;
        }
    }
}
