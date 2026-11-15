import type { ToolDefinition, ExecutionContext } from '@backendkit-labs/agent-core';
import { getStore } from '../context-services';
import { warnIfSecrets } from './secret-scanner';

export const updateSessionTool: ToolDefinition = {
    name: 'update_session',
    description: [
        'Update memory/session.md with the current work state.',
        'Call this after completing a task, a wave of agent calls, or making key decisions.',
        'Decisions and learnings ACCUMULATE over time — do not repeat existing ones.',
        'Issues and next_steps REPLACE the current list — provide the full updated list.',
    ].join(' '),
    parameters: {
        type: 'object',
        properties: {
            feature: {
                type: 'string',
                description: 'What is being worked on right now and its progress. Example: "auth-login — implementing JWT refresh token rotation (70%)"',
            },
            decisions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Key technical decisions made in this turn (each appended as a bullet). Example: ["Use Redis for session storage — lower latency than DB", "Rotate refresh tokens on each use"]',
            },
            issues: {
                type: 'array',
                items: { type: 'string' },
                description: 'Current blockers or open items — replaces the full list. Empty array clears all issues.',
            },
            next_steps: {
                type: 'array',
                items: { type: 'string' },
                description: 'What needs to happen next — replaces the full list.',
            },
            learnings: {
                type: 'array',
                items: { type: 'string' },
                description: 'Non-obvious things discovered about the codebase (each appended as a bullet). Example: ["UserService caches tokens in memory — invalidation requires service restart"]',
            },
        },
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const updates = args as {
            feature?: string;
            decisions?: string[];
            issues?: string[];
            next_steps?: string[];
            learnings?: string[];
        };
        if (!getStore(ctx)) return 'Error: no persistent store configured';
        warnIfSecrets('update_session', JSON.stringify(updates));
        getStore(ctx)!.updateSession(updates);
        return 'Session updated.';
    },
};
