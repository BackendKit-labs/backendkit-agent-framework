import { getService, type ExecutionContext } from '@backendkit-labs/agent-core';
import type { ProjectStoreData } from './store/types';

/** Keys under which the coding vertical hands its dependencies to its tools (`services` engine option). */
export const CODING_SERVICES = {
    store: 'coding.store',
    blockedCommands: 'coding.blockedCommands',
} as const;

/** The persistent project store (context, learnings, audits), when the engine was given one. */
export function getStore(ctx: Pick<ExecutionContext, 'services'>): ProjectStoreData | undefined {
    return getService<ProjectStoreData>(ctx, CODING_SERVICES.store);
}

/** Shell binaries the running agent may not execute (from its profile's `blockedCommands`). */
export function getBlockedCommands(ctx: Pick<ExecutionContext, 'services'>): string[] {
    return getService<string[]>(ctx, CODING_SERVICES.blockedCommands) ?? [];
}
