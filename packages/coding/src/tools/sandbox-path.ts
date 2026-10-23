import type { ExecutionContext } from '@backendkit-labs/agent-core';

/**
 * Asks the engine's sandbox (if any) whether `tool` may touch `abs`, judged by where the path really points.
 * Returns the error text for the model when it may not, `undefined` when it may or there is no sandbox.
 * Called AFTER `resolveAndCheck`, which stays as the floor: a sandbox in full access never loosens the tool's own limit.
 */
export function sandboxPathError(
    ctx: ExecutionContext, tool: string, abs: string, access: 'read' | 'write',
): string | undefined {
    const verdict = ctx.sandbox?.authorizePath?.(
        { agentId: ctx.agentId, sessionId: ctx.sessionId },
        { tool, path: abs, access, workspace: ctx.workingDir ?? process.cwd(), extraRoots: ctx.additionalRoots ?? [] },
    );
    return verdict && !verdict.ok ? `Error: ${verdict.code}: ${verdict.reason}` : undefined;
}
