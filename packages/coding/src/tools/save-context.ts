import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const saveContextTool: ToolDefinition = {
    name: 'save_context',
    description: 'Save a discovery about the project — tech stack, architecture, key files, conventions. This persists across sessions.',
    parameters: {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'The context to save (markdown supported)' },
        },
        required: ['content'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { content } = args as { content: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendContext(content);
        return `Context saved.`;
    },
};
