import type {
    AgentInfo,
    AgentContext,
    AuditEntry,
    AuditQuery,
    ControlAction,
    RunRequest,
    RunResponse,
    RunSummary,
    TaskRecord,
    ProtocolResponse,
} from '../types';
import { CircuitBreaker, CircuitBreakerState } from '@backendkit-labs/circuit-breaker';
import type { CircuitBreakerConfig } from '@backendkit-labs/circuit-breaker';
import { RetryEngine } from '@backendkit-labs/retry';

export interface AgentClientOptions {
    url:             string;
    apiKey?:         string;
    /** Key for control calls (`control`, `listRuns`, `audit`). Never falls back to `apiKey`. */
    controlApiKey?:  string;
    tenantId?:       string;
    /** Per-request timeout in ms. Default: 30 000 */
    timeout?:        number;
    /** Max retries on transient errors (5xx, 429, network). Default: 3 */
    maxRetries?:     number;
    /**
     * Circuit breaker config.
     * - true (default): sliding-window breaker, only 5xx/network open the circuit
     * - false: disabled
     * - Partial<CircuitBreakerConfig>: custom overrides on top of the defaults
     */
    circuitBreaker?: boolean | Partial<Omit<CircuitBreakerConfig, 'name'>>;
}

export interface RunOptions {
    async?:          boolean;
    context?:        AgentContext;
    pollInterval?:   number;
    maxWait?:        number;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AgentClient {
    readonly baseUrl:                  string;
    private readonly baseHeaders:      Record<string, string>;
    private readonly timeout:          number;
    private readonly controlApiKey?:   string;
    private readonly cb:               CircuitBreaker | null;
    private readonly retryEngine:      RetryEngine;

    constructor(opts: AgentClientOptions) {
        this.baseUrl = opts.url.replace(/\/$/, '');
        this.timeout = opts.timeout ?? 30_000;
        this.controlApiKey = opts.controlApiKey;
        this.baseHeaders = {
            'Content-Type': 'application/json',
            ...(opts.apiKey   ? { Authorization:  `Bearer ${opts.apiKey}` } : {}),
            ...(opts.tenantId ? { 'X-Tenant-ID':  opts.tenantId           } : {}),
        };

        // ── Circuit breaker ────────────────────────────────────────────────
        const cbOption = opts.circuitBreaker ?? true;
        if (cbOption !== false) {
            const defaults: CircuitBreakerConfig = {
                name:               `agent::${this.baseUrl}`,
                failureThreshold:   50,    // open when ≥50% of window fails
                slowCallThreshold:  100,   // disabled (100%)
                slowCallDurationMs: 60_000,
                minimumCalls:       5,
                slidingWindowSize:  10,
                halfOpenMaxCalls:   3,
                openTimeoutMs:      60_000,
                // Only 5xx and network/unknown errors count as infrastructure failures.
                // 4xx (except 429) are business errors — transparent to the circuit.
                // 429 is rate-limiting — counts so the circuit backs off under load.
                isFailure: (err: unknown) => {
                    const status = (err as any)?.status as number | undefined;
                    if (status !== undefined) return status >= 500 || status === 429;
                    return true;
                },
            };
            this.cb = new CircuitBreaker({
                ...defaults,
                ...(typeof cbOption === 'object' ? cbOption : {}),
                name: `agent::${this.baseUrl}`, // name is never overridable
            });
        } else {
            this.cb = null;
        }

        // ── Retry engine ───────────────────────────────────────────────────
        // Duck-type adapter: exposes CircuitBreakerLike to RetryEngine.
        // onSuccess/onError are private on the BK class but public at runtime.
        const cbAdapter = this.cb ? {
            canAttempt: ()              => this.cb!.canAttempt(),
            onSuccess:  (ms: number)    => (this.cb as any).onSuccess(ms),
            onError:    (e: unknown)    => (this.cb as any).onError(e),
            getState:   ()              => this.cb!.getState(),
        } : undefined;

        this.retryEngine = new RetryEngine({
            name: `agent-client::${this.baseUrl}`,
            defaultConfig: {
                maxAttempts: (opts.maxRetries ?? 3) + 1,
                backoff: { type: 'exponential', baseDelay: 500, maxDelay: 16_000, jitter: 'full' },
                // Per-request timeout is handled by AbortController inside the task —
                // no duplicate timeout needed here.
                // Built-in classifiers already cover our cases:
                //   429, 5xx → transient (retry)
                //   4xx      → permanent (abort immediately)
                //   network  → transient (retry)
                //   circuit-open → transient (retry after backoff)
            },
            integrations: {
                ...(cbAdapter ? { circuitBreaker: cbAdapter } : {}),
            },
        });
    }

    // ── Core fetch ──────────────────────────────────────────────────────────

    private async request<T>(
        path:     string,
        init:     RequestInit = {},
        context?: AgentContext,
    ): Promise<ProtocolResponse<T>> {
        const contextHeaders: Record<string, string> = {
            ...(context?.tenantId  ? { 'X-Tenant-ID':  context.tenantId  } : {}),
            ...(context?.traceId   ? { 'X-Trace-ID':   context.traceId   } : {}),
            ...(context?.requestId ? { 'X-Request-ID': context.requestId } : {}),
        };

        const result = await this.retryEngine.execute(async () => {
            const controller = new AbortController();
            const timer      = setTimeout(() => controller.abort(), this.timeout);

            try {
                const res = await fetch(`${this.baseUrl}${path}`, {
                    ...init,
                    headers: {
                        ...this.baseHeaders,
                        ...contextHeaders,
                        ...(init.headers as Record<string, string> ?? {}),
                    },
                    signal: controller.signal,
                });

                const body = await res.json() as ProtocolResponse<T>;

                if (!body.ok) {
                    throw Object.assign(
                        new Error(body.error?.message ?? `Agent error ${res.status}`),
                        { code: body.error?.code, status: res.status },
                    );
                }

                return body;
            } finally {
                clearTimeout(timer);
            }
        });

        if (!result.ok) {
            const isCircuitOpen = result.error.type === 'circuit-open';
            throw Object.assign(
                new Error(result.error.message),
                {
                    code:   isCircuitOpen ? 'AGENT_UNAVAILABLE' : (result.error.type ?? 'UNKNOWN'),
                    status: result.error.status,
                },
            );
        }

        return result.value;
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

    // ── Control (protocol 1.1) ──────────────────────────────────────────────
    // Control calls skip the retry engine and the circuit breaker on purpose: a supervisor must still be able to
    // pause, drain or tighten an agent whose run circuit is open, and an action must never be repeated behind its back.

    private async controlRequest<T>(path: string, init: RequestInit = {}, context?: AgentContext): Promise<T> {
        if (!this.controlApiKey) {
            throw Object.assign(new Error('This client has no controlApiKey'), { code: 'FORBIDDEN' });
        }
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), this.timeout);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                headers: {
                    ...this.baseHeaders,
                    Authorization: `Bearer ${this.controlApiKey}`,
                    ...(context?.tenantId  ? { 'X-Tenant-ID':  context.tenantId  } : {}),
                    ...(context?.traceId   ? { 'X-Trace-ID':   context.traceId   } : {}),
                    ...(context?.requestId ? { 'X-Request-ID': context.requestId } : {}),
                },
                signal: controller.signal,
            });
            const body = await res.json() as ProtocolResponse<T>;
            if (!body.ok) {
                throw Object.assign(new Error(body.error?.message ?? `Agent error ${res.status}`), {
                    code: body.error?.code, status: res.status, details: body.error?.details,
                });
            }
            return body.data as T;
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                throw Object.assign(new Error(`Control request to ${path} timed out after ${this.timeout}ms`), { code: 'TIMEOUT' });
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Sends a control action. Errors carry the protocol `code` (e.g. `CONTROL_UNSUPPORTED`, `POLICY_WIDER_THAN_PARENT`) and the HTTP `status`. */
    async control<T = unknown>(action: ControlAction, params: Record<string, unknown> = {}, context?: AgentContext): Promise<{ action: ControlAction; result?: T; draining?: boolean }> {
        return this.controlRequest('/v1/agent/control', { method: 'POST', body: JSON.stringify({ action, params }) }, context);
    }

    /** Active and recent runs, and whether the agent is draining. */
    async listRuns(): Promise<{ runs: RunSummary[]; draining: boolean }> {
        return this.controlRequest('/v1/agent/runs');
    }

    /** The agent's audit trail, newest last. */
    async audit(query: AuditQuery = {}): Promise<AuditEntry[]> {
        const qs = new URLSearchParams();
        if (query.since) qs.set('since', query.since);
        if (query.limit) qs.set('limit', String(query.limit));
        const data = await this.controlRequest<{ entries: AuditEntry[] }>(`/v1/agent/audit${qs.size ? `?${qs}` : ''}`);
        return data.entries;
    }

    /** Returns the current circuit breaker state ('closed', 'open', 'half_open'). */
    getCircuitState(): CircuitBreakerState {
        return this.cb?.getState() ?? CircuitBreakerState.CLOSED;
    }

    getCircuitMetrics() {
        return this.cb?.getMetrics() ?? null;
    }

    resetCircuit(): void { this.cb?.reset(); }
}
