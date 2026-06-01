/**
 * Controls the iteration lifecycle of the agent loop.
 *
 * Three modes:
 *   interactive  — runs up to maxIterations, then asks the user whether to continue
 *   auto         — runs until the global safety cap (GLOBAL_LIMIT) without asking
 *   step-by-step — calls onStep after every iteration; the user decides each step
 *
 * The host agent connects UI callbacks (confirm dialog, text prompt, etc.) via
 * onIterationLimit (interactive) and onStep (step-by-step).
 */

export type IterationMode = 'interactive' | 'auto' | 'step-by-step';

export interface IterationStats {
    /** Iterations executed in this cycle */
    iterations: number;
    /** Current max before asking again */
    maxIterations: number;
    /** Absolute safety cap — never exceeded */
    globalLimit: number;
    /** How many times the limit was extended by user confirmation */
    totalIncrements: number;
    /** Tool calls executed */
    toolCalls: number;
    /** Milliseconds since the manager was reset */
    elapsedMs: number;
}

export interface IterationManagerOptions {
    /** Default: 'interactive' */
    mode?: IterationMode;
    /** Base iteration limit before asking in interactive mode. Default: 100 */
    maxIterations?: number;
    /** Extra iterations added each time the user confirms to continue. Default: 25 */
    batchSize?: number;
    /**
     * Called when maxIterations is reached in interactive mode.
     * Return true to continue (+batchSize iterations), false to stop.
     */
    onLimitReached?: (stats: IterationStats) => Promise<boolean>;
    /**
     * Called after every iteration in step-by-step mode.
     * Return true to continue, false to stop.
     */
    onStep?: (stats: IterationStats) => Promise<boolean>;
    /**
     * Called when GLOBAL_LIMIT is reached (all modes).
     * Useful for saving state before the hard stop.
     */
    onGlobalLimitReached?: (stats: IterationStats) => Promise<void>;
}

export const DEFAULT_MAX_ITERATIONS = 100;
export const DEFAULT_BATCH_SIZE = 25;
export const GLOBAL_LIMIT = 1000;

export class IterationManager {
    private _iterations = 0;
    private _toolCalls = 0;
    private _totalIncrements = 0;
    private _startTime = Date.now();
    private _stopped = false;
    private _mode: IterationMode;
    private _maxIterations: number;
    private readonly _batchSize: number;
    private readonly _globalLimit = GLOBAL_LIMIT;

    constructor(private readonly options: IterationManagerOptions = {}) {
        this._mode = options.mode ?? 'interactive';
        this._maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    }

    get iterations(): number { return this._iterations; }
    get mode(): IterationMode { return this._mode; }
    get stopped(): boolean { return this._stopped; }

    get stats(): IterationStats {
        return {
            iterations: this._iterations,
            maxIterations: this._maxIterations,
            globalLimit: this._globalLimit,
            totalIncrements: this._totalIncrements,
            toolCalls: this._toolCalls,
            elapsedMs: Date.now() - this._startTime,
        };
    }

    setMode(mode: IterationMode): void { this._mode = mode; }
    setMaxIterations(max: number): void { this._maxIterations = max; }
    recordToolCall(): void { this._toolCalls++; }

    reset(): void {
        this._iterations = 0;
        this._toolCalls = 0;
        this._totalIncrements = 0;
        this._startTime = Date.now();
        this._stopped = false;
    }

    /**
     * Advances one iteration. Returns true if the loop should continue,
     * false if it should stop (limit reached and user declined, or mode stopped).
     */
    async advance(): Promise<boolean> {
        if (this._stopped) return false;

        this._iterations++;

        // Hard safety cap — never exceeded regardless of mode
        if (this._iterations >= this._globalLimit) {
            this._stopped = true;
            await this.options.onGlobalLimitReached?.(this.stats);
            return false;
        }

        // step-by-step: ask after the first iteration (skip the initial call)
        if (this._mode === 'step-by-step' && this._iterations > 1) {
            if (this.options.onStep) {
                const cont = await this.options.onStep(this.stats);
                if (!cont) { this._stopped = true; return false; }
            }
            return true;
        }

        // auto: run freely until global cap
        if (this._mode === 'auto') return true;

        // interactive: ask when limit is reached
        if (this._iterations > this._maxIterations) {
            const cont = this.options.onLimitReached
                ? await this.options.onLimitReached(this.stats)
                : false;
            if (cont) {
                this._maxIterations += this._batchSize;
                this._totalIncrements++;
                return true;
            }
            this._stopped = true;
            return false;
        }

        return true;
    }
}
