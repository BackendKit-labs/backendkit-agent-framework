/** What an `AgentEngine` built with `observability` exposes; structural, so Hermes does not import the engine. */
export interface CostSource {
    readonly observability?: { getRunCost(): number };
}

/**
 * The USD the engine's last run spent, for `run.reportCost` in an in-process handler:
 *
 *     handler: async (input, signal, run) => {
 *         const output = await engine.run(String(input.task));
 *         run?.reportCost(engineRunCost(engine) ?? 0);
 *         return output;
 *     }
 *
 * `undefined` when the engine has no `observability`, or when it priced nothing (a model without a price entry costs 0
 * there): report nothing then, so the agent stays unmetered instead of looking free. The tracker resets on each run, so
 * an engine serving runs in parallel mixes their costs: give each concurrent run its own engine, or set `maxConcurrent: 1`.
 */
export function engineRunCost(engine: CostSource): number | undefined {
    const usd = engine.observability?.getRunCost();
    return usd !== undefined && Number.isFinite(usd) && usd > 0 ? usd : undefined;
}
