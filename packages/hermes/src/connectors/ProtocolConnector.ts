import { AgentClient } from '@backendkit-labs/agent-protocol';
import type { TaskRecord } from '@backendkit-labs/agent-protocol';
import type {
    AgentAuditEntry, AgentConnector, AgentControlPort, AgentDescriptor, CapabilityInfo, ConnectorRunContext, ConnectorRunRequest, HealthReport, RunHandle, RunLookup, RunOutcome, RunStatus,
} from './types';

export interface ProtocolConnectorOptions {
    url: string;
    /**
     * The key, read when it is needed (not once at startup), so a rotated secret applies to the next call.
     * Never logged, never stored.
     */
    apiKey?: () => string | undefined;
    /** The control key, read when needed like `apiKey`. Without it the agent has no control port. */
    controlApiKey?: () => string | undefined;
    timeoutMs?: number;
    maxRetries?: number;
    /** How often a background run is asked for its state. Default 1000 ms. */
    pollIntervalMs?: number;
}

const TERMINAL = new Set<TaskRecord['status']>(['done', 'failed', 'cancelled']);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

const outcomeOf = (t: TaskRecord): RunOutcome => ({
    status: t.status as RunOutcome['status'],
    ...(t.output !== undefined ? { output: t.output } : {}),
    ...(t.error ? { error: t.error } : {}),
});

/** Reaches an agent served by `AgentServer` (agent-protocol 1.x). Needs nothing the 1.0 protocol does not have. */
export class ProtocolConnector implements AgentConnector {
    readonly kind = 'protocol' as const;
    private client?: AgentClient;
    private clientKey?: string;
    private clientControlKey?: string;
    private capabilities = new Map<string, CapabilityInfo>();

    constructor(private readonly options: ProtocolConnectorOptions) {}

    /** One client per key: its circuit breaker keeps its history, and a rotated key gets a fresh one. */
    private api(): AgentClient {
        const key = this.options.apiKey?.();
        const controlKey = this.options.controlApiKey?.();
        if (!this.client || key !== this.clientKey || controlKey !== this.clientControlKey) {
            this.clientKey = key;
            this.clientControlKey = controlKey;
            this.client = new AgentClient({
                url: this.options.url,
                ...(key ? { apiKey: key } : {}),
                ...(controlKey ? { controlApiKey: controlKey } : {}),
                ...(this.options.timeoutMs ? { timeout: this.options.timeoutMs } : {}),
                ...(this.options.maxRetries !== undefined ? { maxRetries: this.options.maxRetries } : {}),
            });
        }
        return this.client;
    }

    control(): AgentControlPort | undefined {
        if (!this.options.controlApiKey?.()) return undefined;
        return {
            // What the agent says it accepts is in `info.control`; until asked, assume nothing beyond what a call proves.
            actions: this.controlActions,
            call: async (action, params) => {
                const out = await this.api().control(action as never, params);
                return out.result ?? out;
            },
            audit: async query => await this.api().audit(query) as AgentAuditEntry[],
        };
    }

    private controlActions: string[] = [];

    async describe(): Promise<AgentDescriptor> {
        const info = await this.api().info();
        this.controlActions = info.control ?? [];
        this.capabilities = new Map(info.capabilities.map(c => [c.name, { name: c.name, description: c.description, async: c.async, input: c.input }]));
        return { name: info.name, version: info.version, description: info.description, capabilities: [...this.capabilities.values()] };
    }

    /**
     * A plain request, without the client's retries and circuit breaker: a check must answer in one timeout, and
     * an agent that went down must show as down at the next check, not after the backoff.
     */
    async health(signal?: AbortSignal): Promise<HealthReport> {
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 3000);
        signal?.addEventListener('abort', () => controller.abort(), { once: true });
        try {
            const res = await fetch(`${this.options.url.replace(/\/$/, '')}/v1/agent/health`, { signal: controller.signal });
            const latencyMs = Date.now() - started;
            return res.ok ? { state: 'ok', latencyMs } : { state: 'degraded', latencyMs, detail: `HTTP ${res.status}` };
        } catch (err) {
            return { state: 'down', detail: controller.signal.aborted ? 'no answer in time' : (err as Error).message };
        } finally {
            clearTimeout(timer);
        }
    }

    async run(request: ConnectorRunRequest, context: ConnectorRunContext = {}): Promise<RunHandle> {
        if (!this.capabilities.size) await this.describe().catch(() => undefined);
        const wantAsync = request.async ?? this.capabilities.get(request.capability)?.async ?? false;
        const agentContext = { ...(context.traceId ? { traceId: context.traceId } : {}), ...(context.tenantId ? { tenantId: context.tenantId } : {}) };
        const response = await this.api().run(request.capability, request.input, { async: wantAsync, context: agentContext });

        if (response.status === 'done' || !response.taskId) {
            const outcome: RunOutcome = { status: 'done', output: response.output };
            return { connectorRunId: response.taskId ?? 'inline', result: async () => outcome, status: async () => 'done', cancel: async () => undefined };
        }
        return this.handleFor(response.taskId, context.signal);
    }

    private handleFor(taskId: string, signal?: AbortSignal): RunHandle {
        const poll = (): Promise<TaskRecord> => this.api().poll(taskId);
        return {
            connectorRunId: taskId,
            status: async () => (await poll()).status,
            cancel: () => this.api().cancel(taskId),
            result: async () => {
                for (;;) {
                    const task = await poll();
                    if (TERMINAL.has(task.status)) return outcomeOf(task);
                    if (signal?.aborted) return { status: 'cancelled', error: 'stopped waiting' };
                    await sleep(this.options.pollIntervalMs ?? 1000, signal);
                }
            },
        };
    }

    async lookup(connectorRunId: string): Promise<RunLookup> {
        try {
            const task = await this.api().poll(connectorRunId);
            return { found: true, status: task.status as RunStatus, ...(task.output !== undefined ? { output: task.output } : {}), ...(task.error ? { error: task.error } : {}) };
        } catch (err) {
            // The agent answered and does not know the run: lost. Anything else (no connection, 5xx) is not an answer.
            if ((err as { status?: number }).status === 404) return { found: false };
            throw err;
        }
    }

    cancel(connectorRunId: string): Promise<void> {
        return this.api().cancel(connectorRunId);
    }

    /** Lets a caller of `lookup` follow a run it did not start in this process. */
    follow(connectorRunId: string, signal?: AbortSignal): RunHandle {
        return this.handleFor(connectorRunId, signal);
    }
}
