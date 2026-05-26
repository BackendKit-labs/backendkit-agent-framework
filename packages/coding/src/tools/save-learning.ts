import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const saveLearningTool: ToolDefinition = {
    name: 'save_learning',
    description: 'Save a learned preference or correction specific to this project — what the user likes, dislikes, or corrected. Persists across sessions.',
    parameters: {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'The learning to save (e.g. "user prefers small atomic commits")' },
        },
        required: ['content'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { content } = args as { content: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendLearning(content);
        return `Learning saved.`;
    },
};
