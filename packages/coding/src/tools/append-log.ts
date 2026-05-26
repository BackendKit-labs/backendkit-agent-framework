import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const appendLogTool: ToolDefinition = {
    name: 'append_log',
    description: 'Append an entry to the project activity log. Call this after completing a significant task so future sessions have history.',
    parameters: {
        type: 'object',
        properties: {
            entry: { type: 'string', description: 'Short description of what was done (e.g. "Added JSDoc to ToolRegistry.ts")' },
        },
        required: ['entry'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { entry } = args as { entry: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendLog(entry);
        return `Log entry saved.`;
    },
};
