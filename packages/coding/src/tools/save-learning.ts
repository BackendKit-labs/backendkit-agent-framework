import { defineTool, z } from '@bk/agent-core';

export const saveLearningTool = defineTool({
    name: 'save_learning',
    description: 'Save a learned preference or correction specific to this project. Persists across sessions.',
    input: z.object({
        content: z.string().min(1).describe('The learning to save (e.g. "user prefers small atomic commits")'),
    }),
    execute: async ({ content }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendLearning(content);
        return 'Learning saved.';
    },
});
