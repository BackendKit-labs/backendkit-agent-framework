import type { ExecutionContext } from '../types';
import type { ApproverRef } from '../governance/types';
import type { LearnedRulesView } from '../learning/types';

/**
 * Reads a dependency a vertical handed to its tools through `services` (engine option). Returns undefined when
 * the engine was not given that key; a tool that needs it should answer with a clear error.
 */
export function getService<T>(ctx: Pick<ExecutionContext, 'services'>, key: string): T | undefined {
    return ctx.services?.get(key) as T | undefined;
}

/** The key under which `createBaseEngine({ learning })` gives the tools a read-only view of the approved rules. */
export const LEARNED_RULES_SERVICE = 'learning.rules';

/**
 * The rules a person approved (for the tenant of the engine) that satisfy `guard`. How a tool enforces a rule of its own kind
 * without owning a store: `const guards = await learnedRules(ctx, isEntryGuard)`. Empty when the engine has no `learning`.
 */
export async function learnedRules<T>(
    ctx: Pick<ExecutionContext, 'services'>, guard: (rule: unknown) => rule is T,
): Promise<Array<{ id: string; rule: T; approvedAt: string; approvedBy: ApproverRef }>> {
    const view = getService<LearnedRulesView>(ctx, LEARNED_RULES_SERVICE);
    return view ? view.where(guard) : [];
}
