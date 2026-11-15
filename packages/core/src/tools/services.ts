import type { ExecutionContext } from '../types';

/**
 * Reads a dependency a vertical handed to its tools through `services` (engine option). Returns undefined when
 * the engine was not given that key; a tool that needs it should answer with a clear error.
 */
export function getService<T>(ctx: Pick<ExecutionContext, 'services'>, key: string): T | undefined {
    return ctx.services?.get(key) as T | undefined;
}
