import { defineTool, z } from '@backendkit-labs/agent-core';
import { getStore } from '../context-services';
import { warnIfSecrets } from './secret-scanner';

export const saveContextTool = defineTool({
    name: 'save_context',
    description: 'Save a discovery about the project — tech stack, architecture, key files, conventions. Persists across sessions.',
    input: z.object({
        content: z.string().min(1).describe('The context to save (markdown supported)'),
    }),
    execute: async ({ content }, ctx) => {
        if (!getStore(ctx)) return 'Error: no persistent store configured';
        warnIfSecrets('save_context', content); // does not block, but warns
        getStore(ctx)!.appendContext(content);
        return 'Context saved.';
    },
});
