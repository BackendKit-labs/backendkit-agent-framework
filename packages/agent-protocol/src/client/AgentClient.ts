import type {
    AgentInfo,
    AgentContext,
    RunRequest,
    RunResponse,
    TaskRecord,
    ProtocolResponse,
} from '../types';
import { withRetry } from '../resilience/retry';
import { CircuitBreaker } from '../resilience/CircuitBreaker';

export interface AgentClientOptions {
    url:              string;
    apiKey?:          string;
    tenantId?:        string;
    timeout?:         number;   // ms per request, default 30000
    maxRetries?:      number;   // default 3
    circuitBreaker?:  boolean;  // default true
}

export interface RunOptions {
    async?:          boolean;
    context?:        AgentContext;
    pollInterval?:   number;  // ms between polls for runAndWait, default 2000
    maxWait?:        number;  // ms max total wait for runAndWait, default 300000
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AgentClient {
    private readonly baseUrl:    string;
    private readonly baseHeaders: Record<string, string>;
    private readonly timeout:    number;
    private readonly maxRetries: number;
    private readonly cb:         CircuitBreaker | null;

    constructor(opts: AgentClientOptions) {
        this.baseUrl    = opts.url.replace(/\/$/, '');
        this.timeout    = opts.timeout    ?? 30_000;
        this.maxRetries = opts.maxRetries ?? 3;
        this.cb         = opts.circuitBreaker !== false ? new CircuitBreaker() : null;
        this.baseHeaders = {
            'Content-Type': 'application/json',
            ...(opts.apiKey   ? { Authorization:   `Bearer ${opts.apiKey}` } : {}),
            ...(opts.tenantId ? { 'X-Tenant-ID':   opts.tenantId           } : {}),
        };
    }

    // ── Core fetch ──────────────────────────────────────────────────────────

    private async request<T>(
        path:    string,
        init:    RequestInit = {},
        context?: AgentContext,
    ): Promise<ProtocolResponse<T>> {
        const contextHeaders: Record<string, string> = {
            ...(context?.tenantId  ? { 'X-Tenant-ID':   context.tenantId  } : {}),
            ...(context?.traceId   ? { 'X-Trace-ID':    context.traceId   } : {}),
            ...(context?.requestId ? { 'X-Request-ID':  context.requestId } : {}),
        };

        const execute = async (): Promise<ProtocolResponse<T>> => {
            const controller = new AbortController();
            const timer      = setTimeout(() => controller.abort(), this.timeout);

            let res: globalThis.Response;
            try {
                res = await fetch(`${this.baseUrl}${path}`, {
                    ...init,
                    headers: { ...this.baseHeaders, ...contextHeaders, ...(init.headers as Record<string, string> ?? {}) },
                    signal:  controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }

            const body = await res.json() as ProtocolResponse<T>;

            if (!body.ok) {
                const err = Object.assign(
                    new Error(body.error?.message ?? `Agent error ${res.status}`),
                    { code: body.error?.code, status: res.status },
                );
                throw err;
            }

            return body;
        };

        const withResilience = () => withRetry(execute, {
            maxRetries: this.maxRetries,
            retryOn:    (err: any) => err.status === 503 || err.status === 429,
        });

        return this.cb ? this.cb.execute(withResilience) : withResilience();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async health(): Promise<boolean> {
        try {
            await this.request('/v1/agent/health');
            return true;
        } catch {
            return false;
        }
    }

    async info(): Promise<AgentInfo> {
        const res = await this.request<AgentInfo>('/v1/agent/info');
        return res.data!;
    }

    async run(capability: string, input: Record<string, unknown>, opts: RunOptions = {}): Promise<RunResponse> {
        const body: RunRequest = { capability, input, ...(opts.async !== undefined ? { async: opts.async } : {}) };
        const res = await this.request<RunResponse>(
            '/v1/agent/run',
            { method: 'POST', body: JSON.stringify(body) },
            opts.context,
        );
        return res.data!;
    }

    async poll(taskId: string): Promise<TaskRecord> {
        const res = await this.request<TaskRecord>(`/v1/agent/tasks/${taskId}`);
        return res.data!;
    }

    async cancel(taskId: string): Promise<void> {
        await this.request(`/v1/agent/tasks/${taskId}`, { method: 'DELETE' });
    }

    // Runs a capability and auto-polls until done if the agent responds async
    async runAndWait(capability: string, input: Record<string, unknown>, opts: RunOptions = {}): Promise<unknown> {
        const result = await this.run(capability, input, opts);

        if (result.status === 'done') return result.output;

        const { pollInterval = 2_000, maxWait = 300_000 } = opts;
        const deadline = Date.now() + maxWait;
        const taskId   = result.taskId!;

        while (Date.now() < deadline) {
            await sleep(pollInterval);
            const task = await this.poll(taskId);
            if (task.status === 'done')      return task.output;
            if (task.status === 'failed')    throw new Error(task.error ?? 'Task failed');
            if (task.status === 'cancelled') throw new Error('Task was cancelled');
        }

        throw Object.assign(
            new Error(`Task ${taskId} timed out after ${maxWait}ms`),
            { code: 'TIMEOUT' },
        );
    }

    getCircuitState() { return this.cb?.getState() ?? 'CLOSED'; }
    resetCircuit()    { this.cb?.reset(); }
}
