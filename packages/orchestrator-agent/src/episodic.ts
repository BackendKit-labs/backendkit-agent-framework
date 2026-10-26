import type { IRunStore, StepResult } from './run-store.js';

/** How long the list of past successful steps is reused before the store is read again. */
const STEPS_TTL_MS = 60_000;

/**
 * Cross-run episodic memory: past successful outputs by the same agent for similar tasks.
 *
 * It used to read every stored run for every subtask (N subtasks = N full scans of the run store, which on
 * Redis is KEYS + one GET per run). The candidate steps are now loaded once and reused for `ttlMs`; concurrent
 * callers share the load. Runs that finish inside that window are picked up at the next refresh, which is fine
 * for "examples from past runs".
 */
export function buildEpisodicFn(
    store: IRunStore,
    opts: { ttlMs?: number; now?: () => number } = {},
): (agentId: string, task: string) => Promise<string> {
    const ttlMs = opts.ttlMs ?? STEPS_TTL_MS;
    const now = opts.now ?? Date.now;

    let cached: { steps: StepResult[]; at: number } | undefined;
    let loading: Promise<StepResult[]> | undefined;

    const loadSteps = (): Promise<StepResult[]> => {
        if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.steps);
        if (loading) return loading;
        loading = (async () => {
            try {
                const runs = await store.list();
                const steps = runs
                    .filter(r => r.status === 'complete')
                    .flatMap(r => r.completedSteps)
                    .filter(s => s.success && s.output.length > 50);
                cached = { steps, at: now() };
                return steps;
            } catch {
                return []; // a store failure is not cached: the next call tries again
            } finally {
                loading = undefined;
            }
        })();
        return loading;
    };

    return async (agentId: string, taskText: string): Promise<string> => {
        const steps = (await loadSteps()).filter(s => s.agentId === agentId);
        if (steps.length === 0) return '';

        const queryTokens = taskText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (queryTokens.length === 0) return '';

        const scored = steps
            .map(s => {
                const text  = (s.task + ' ' + s.output).toLowerCase();
                const score = queryTokens.filter(w => text.includes(w)).length / queryTokens.length;
                return { s, score };
            })
            .filter(x => x.score >= 0.15)
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

        if (scored.length === 0) return '';

        return '\n\nExamples from past successful runs by this agent:\n' +
            scored.map(x =>
                `Task: ${x.s.task}\nResult: ${x.s.output.slice(0, 400)}`,
            ).join('\n\n');
    };
}
