import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const saveUserPreferenceTool: ToolDefinition = {
    name: 'save_user_preference',
    description: 'Save a global user preference that applies across all projects — communication style, general habits, things to always or never do.',
    parameters: {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'The preference to save (e.g. "user prefers concise responses, no emojis")' },
        },
        required: ['content'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { content } = args as { content: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.appendUserPreference(content);
        return `User preference saved.`;
    },
};
