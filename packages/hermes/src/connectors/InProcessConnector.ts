import { randomUUID } from 'node:crypto';
import type {
    AgentConnector, AgentDescriptor, CapabilityInfo, ConnectorRunContext, ConnectorRunRequest, HealthReport, RunHandle, RunOutcome, RunStatus,
} from './types';

export interface InProcessCapability extends Partial<Pick<CapabilityInfo, 'description' | 'input'>> {
    /** Takes long: Hermes starts it and answers with a run id. Default false. */
    async?: boolean;
    /** Does the work. `signal` aborts when the run is cancelled. A throw is a failed run. */
    handler(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}

export interface InProcessConnectorOptions {
    name: string;
    version?: string;
    description?: string;
    capabilities: Record<string, InProcessCapability>;
}

interface Live {
    controller: AbortController;
    status: RunStatus;
    outcome?: RunOutcome;
    done: Promise<RunOutcome>;
}

/**
 * An agent that runs inside the Hermes process (an `AgentEngine` behind a handler, a function, a test double).
 * Its runs live in memory, so they do not survive Hermes: after a restart they are `lost`.
 */
export class InProcessConnector implements AgentConnector {
    readonly kind = 'in-process' as const;
    private readonly runs = new Map<string, Live>();
    private available = true;

    constructor(private readonly options: InProcessConnectorOptions) {}

    /** For tests and maintenance: report the agent as down. */
    setAvailable(available: boolean): void { this.available = available; }

    async describe(): Promise<AgentDescriptor> {
        return {
            name: this.options.name,
            ...(this.options.version ? { version: this.options.version } : {}),
            ...(this.options.description ? { description: this.options.description } : {}),
            capabilities: Object.entries(this.options.capabilities).map(([name, c]) => ({
                name, description: c.description ?? name, async: c.async ?? false, ...(c.input !== undefined ? { input: c.input } : {}),
            })),
        };
    }

    async health(): Promise<HealthReport> {
        return this.available ? { state: 'ok', latencyMs: 0 } : { state: 'down', detail: 'unavailable' };
    }

    async run(request: ConnectorRunRequest, context: ConnectorRunContext = {}): Promise<RunHandle> {
        const capability = this.options.capabilities[request.capability];
        if (!capability) throw Object.assign(new Error(`capability "${request.capability}" not found`), { code: 'CAPABILITY_NOT_FOUND' });
        if (!this.available) throw Object.assign(new Error('agent is unavailable'), { code: 'AGENT_UNAVAILABLE' });

        const controller = new AbortController();
        context.signal?.addEventListener('abort', () => controller.abort(), { once: true });
        const live: Live = { controller, status: 'running', done: undefined as unknown as Promise<RunOutcome> };
        live.done = Promise.resolve()
            .then(() => capability.handler(request.input, controller.signal))
            .then<RunOutcome, RunOutcome>(
                output => ({ status: controller.signal.aborted ? 'cancelled' : 'done', output }),
                err => ({ status: controller.signal.aborted ? 'cancelled' : 'failed', error: err instanceof Error ? err.message : String(err) }),
            )
            .then(outcome => { live.status = outcome.status; live.outcome = outcome; return outcome; });

        const id = randomUUID();
        this.runs.set(id, live);
        return {
            connectorRunId: id,
            result: () => live.done,
            status: async () => live.status,
            cancel: async () => {
                if (live.status !== 'running') return;
                controller.abort();
                await live.done;
            },
        };
    }

    /** Stops every run still going (Hermes shutting down). */
    async close(): Promise<void> {
        for (const live of this.runs.values()) live.controller.abort();
        await Promise.allSettled([...this.runs.values()].map(l => l.done));
    }
}
