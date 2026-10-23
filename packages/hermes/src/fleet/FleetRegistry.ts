import { ProtocolConnector } from '../connectors/ProtocolConnector';
import type { AgentConnector, AgentDescriptor, HealthReport } from '../connectors/types';
import type { AgentConfig, FleetConfig } from './schema';

export type AgentState = 'unknown' | 'ok' | 'degraded' | 'down';

export interface AgentHealth {
    state: AgentState;
    latencyMs?: number;
    detail?: string;
    /** When the last check ended, and since when the agent is in this state. */
    checkedAt?: string;
    since?: string;
}

export interface FleetAgent {
    readonly id: string;
    readonly config: AgentConfig;
    readonly connector: AgentConnector;
    health: AgentHealth;
    /** What the agent said about itself the last time it was asked. */
    descriptor?: AgentDescriptor;
}

export type HealthListener = (agent: FleetAgent, previous: AgentState) => void;

export interface RegistryOptions {
    /** Agents of kind `in-process`, by id. */
    inProcess?: Record<string, AgentConnector>;
    /** Where `{ env }` references are read. Default `process.env`. */
    env?: Record<string, string | undefined>;
    onHealthChange?: HealthListener;
}

const DEFAULT_INTERVAL_MS = 30_000;

/** Builds the connector each agent of the file asks for. */
export function connectorsFor(config: FleetConfig, options: RegistryOptions = {}): Map<string, AgentConnector> {
    const env = options.env ?? process.env;
    const out = new Map<string, AgentConnector>();
    for (const agent of config.agents) {
        const c = agent.connector;
        if (c.kind === 'protocol') {
            const ref = c.apiKey?.env;
            const controlRef = c.controlApiKey?.env;
            out.set(agent.id, new ProtocolConnector({
                url: c.url,
                ...(ref ? { apiKey: () => env[ref] } : {}),
                ...(controlRef ? { controlApiKey: () => env[controlRef] } : {}),
                ...(c.timeoutMs ? { timeoutMs: c.timeoutMs } : {}),
                ...(c.maxRetries !== undefined ? { maxRetries: c.maxRetries } : {}),
                ...(c.pollIntervalMs ? { pollIntervalMs: c.pollIntervalMs } : {}),
            }));
        } else {
            const connector = options.inProcess?.[agent.id];
            if (!connector) throw new Error(`agent "${agent.id}" is in-process but no connector was registered for it`);
            out.set(agent.id, connector);
        }
    }
    return out;
}

/** The agents of a fleet, with the last known state of each. Checks them on a timer once started. */
export class FleetRegistry {
    private readonly agents = new Map<string, FleetAgent>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private running = false;
    private readonly onHealthChange?: HealthListener;

    constructor(readonly config: FleetConfig, options: RegistryOptions = {}) {
        this.onHealthChange = options.onHealthChange;
        const connectors = connectorsFor(config, options);
        for (const a of config.agents) {
            this.agents.set(a.id, { id: a.id, config: a, connector: connectors.get(a.id)!, health: { state: 'unknown' } });
        }
    }

    get(id: string): FleetAgent | undefined { return this.agents.get(id); }
    list(): FleetAgent[] { return [...this.agents.values()]; }

    /** Checks every agent once, then keeps checking each at its own interval. */
    async start(): Promise<void> {
        this.running = true;
        await Promise.all(this.list().map(a => this.check(a)));
        for (const a of this.list()) this.schedule(a);
    }

    stop(): void {
        this.running = false;
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
    }

    /** Adds an agent while running (one Hermes created): checks it now and keeps checking it. */
    async add(config: AgentConfig, connector: AgentConnector): Promise<FleetAgent> {
        if (this.agents.has(config.id)) throw new Error(`agent "${config.id}" already exists`);
        const agent: FleetAgent = { id: config.id, config, connector, health: { state: 'unknown' } };
        this.agents.set(config.id, agent);
        await this.check(agent);
        if (this.agents.get(config.id) === agent) this.schedule(agent);
        return agent;
    }

    /** Takes an agent out of the fleet and stops checking it. */
    remove(id: string): FleetAgent | undefined {
        const agent = this.agents.get(id);
        if (!agent) return undefined;
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
        this.agents.delete(id);
        return agent;
    }

    /** Asks one agent (or all) now, outside the timer. */
    async checkNow(id?: string): Promise<void> {
        const targets = id ? [this.agents.get(id)].filter((a): a is FleetAgent => !!a) : this.list();
        await Promise.all(targets.map(a => this.check(a)));
    }

    private schedule(agent: FleetAgent): void {
        if (!this.running) return;
        const interval = (agent.config.health?.intervalSec ?? DEFAULT_INTERVAL_MS / 1000) * 1000;
        const timer = setTimeout(() => {
            if (this.agents.get(agent.id) !== agent) return; // removed meanwhile
            void this.check(agent).finally(() => this.schedule(agent));
        }, interval);
        timer.unref?.();
        this.timers.set(agent.id, timer);
    }

    private async check(agent: FleetAgent): Promise<void> {
        const timeoutMs = agent.config.health?.timeoutMs ?? 3000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let report: HealthReport;
        try {
            report = await agent.connector.health(controller.signal);
        } catch (err) {
            report = { state: 'down', detail: (err as Error).message };
        } finally {
            clearTimeout(timer);
        }
        const previous = agent.health.state;
        const now = new Date().toISOString();
        const state: AgentState = report.state;
        agent.health = {
            state,
            ...(report.latencyMs !== undefined ? { latencyMs: report.latencyMs } : {}),
            ...(report.detail ? { detail: report.detail } : {}),
            checkedAt: now,
            since: state === previous ? agent.health.since ?? now : now,
        };
        if (state !== previous) {
            try { this.onHealthChange?.(agent, previous); } catch { /* an observer must not stop the checks */ }
        }
        if (state !== 'down' && (previous === 'unknown' || previous === 'down' || !agent.descriptor)) {
            agent.descriptor = await agent.connector.describe().catch(() => agent.descriptor);
        }
    }
}
