import { defineTool, z } from '@backendkit-labs/agent-core';
import { warnIfSecrets } from './secret-scanner';

export const saveContextTool = defineTool({
    name: 'save_context',
    description: 'Save a discovery about the project — tech stack, architecture, key files, conventions. Persists across sessions.',
    input: z.object({
        content: z.string().min(1).describe('The context to save (markdown supported)'),
    }),
    execute: async ({ content }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        warnIfSecrets('save_context', content); // does not block, but warns
        ctx.store.appendContext(content);
        return 'Context saved.';
    },
});
