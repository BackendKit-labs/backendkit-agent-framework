/**
 * Approving or rejecting a gate is load -> check "waiting_gate" -> save "running" -> resume the plan. Two approvals
 * for the same run that overlap (a retried HTTP call, a double click, the MCP tool and the HTTP endpoint at once) both
 * pass the check before either saves, and the plan resumes twice: duplicated LLM calls and notes, last writer wins.
 *
 * A run is claimed for the length of that sequence; whoever finds it claimed is told it is already being decided.
 * Once the first one has saved "running", later calls fail the status check on their own.
 *
 * This one is in-process: it covers every entry point of one orchestrator process (MCP tool and HTTP endpoint share it).
 * Several processes on one run store also take `IRunStore.claim` (see `claimInStore`) once they have the store.
 */
const inFlight = new Map<string, symbol>();

/**
 * Claims the run; returns the release function, or null if it is already claimed. A release frees only its own
 * claim: calling it again later cannot free one that someone else has taken since.
 */
export function claimRun(runId: string): (() => void) | null {
    if (inFlight.has(runId)) return null;
    const owner = Symbol(runId);
    inFlight.set(runId, owner);
    return () => { if (inFlight.get(runId) === owner) inFlight.delete(runId); };
}

/**
 * The same claim across processes, when the store can provide it (Redis, or the run directory on disk).
 * Returns the release function, or null when another process holds the run. A store without `claim` gives a
 * no-op release: it falls back to the in-process claim above.
 */
export async function claimInStore(
    store: { claim?(runId: string, ttlMs?: number): Promise<(() => Promise<void>) | null> },
    runId: string,
): Promise<(() => Promise<void>) | null> {
    if (!store.claim) return async () => undefined;
    return store.claim(runId);
}

/** Runs `fn` holding the claim, or `onBusy()` if the run is already claimed. The claim is always released. */
export async function withRunClaim<T>(runId: string, onBusy: () => T, fn: () => Promise<T>): Promise<T> {
    const release = claimRun(runId);
    if (!release) return onBusy();
    try {
        return await fn();
    } finally {
        release();
    }
}
