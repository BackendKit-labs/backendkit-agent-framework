import { defineTool, z } from '@bk/agent-core';

export const saveContextTool = defineTool({
    name: 'save_context',
    description: 'Save a discovery about the project — tech stack, architecture, key files, conventions. Persists across sessions.',
    input: z.object({
        content: z.string().min(1).describe('The context to save (markdown supported)'),
    }),
    execute: async ({ content }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendContext(content);
        return 'Context saved.';
    },
});
