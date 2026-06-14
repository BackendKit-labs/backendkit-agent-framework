export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
    failureThreshold?: number;  // consecutive failures to open. default: 5
    successThreshold?: number;  // consecutive successes to close from half-open. default: 2
    timeout?:          number;  // ms to wait before moving OPEN → HALF_OPEN. default: 60000
}

export class CircuitBreaker {
    private state:       CircuitState = 'CLOSED';
    private failures     = 0;
    private successes    = 0;
    private nextAttempt  = 0;

    private readonly failureThreshold: number;
    private readonly successThreshold: number;
    private readonly timeout:          number;

    constructor(opts: CircuitBreakerOptions = {}) {
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.successThreshold = opts.successThreshold ?? 2;
        this.timeout          = opts.timeout          ?? 60_000;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw Object.assign(
                    new Error('Circuit breaker is OPEN — agent unavailable'),
                    { code: 'AGENT_UNAVAILABLE' },
                );
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        if (this.state === 'HALF_OPEN') {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.state    = 'CLOSED';
                this.successes = 0;
            }
        }
    }

    private onFailure(): void {
        this.successes = 0;
        this.failures++;
        if (this.failures >= this.failureThreshold || this.state === 'HALF_OPEN') {
            this.state       = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            this.failures    = 0;
        }
    }

    getState(): CircuitState { return this.state; }

    reset(): void {
        this.state     = 'CLOSED';
        this.failures  = 0;
        this.successes = 0;
    }
}
