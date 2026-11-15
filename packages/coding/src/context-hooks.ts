import type { EngineHooks } from '@backendkit-labs/agent-core';
import type { ProjectStoreData } from './store/types';

export interface CodingContextHooksOptions {
    /** The project store; its notes for the running agent go into the prompt. */
    store?: ProjectStoreData;
    /** Working directory the tools resolve relative paths against. */
    workingDir?: string;
}

/** System-prompt sections the coding vertical adds: how to name paths, and the agent's own session notes. */
export function codingContextHooks(opts: CodingContextHooksOptions): EngineHooks {
    return {
        name: 'coding-context',
        systemPrompt(_ctx, profile) {
            const parts: string[] = [];
            if (opts.workingDir) {
                parts.push(
                    `## Paths\n` +
                    `ALWAYS use RELATIVE paths with tools (e.g. \`src/index.ts\`, \`package.json\`). ` +
                    `NEVER invent absolute paths like \`/workspace/...\` or \`/home/...\`.`,
                );
            }
            // Per-agent session notes (tool quirks, learnings routed by LearningRouter)
            const notes = opts.store?.getAgentNotes?.(profile.id);
            if (notes) parts.push(`## Agent Session Notes\n${notes}`);
            return parts.length ? parts.join('\n\n') : undefined;
        },
    };
}
