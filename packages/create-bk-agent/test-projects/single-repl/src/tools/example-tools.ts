import { defineTool, z } from '@backendkit-labs/agent-core';

// TODO: Replace these with tools that call your actual domain SDK/API

export const exampleAction = defineTool({
    name: 'example_action',
    description: 'TODO: describe what this tool does',
    input: z.object({
        target: z.string().describe('Target to act on'),
        // TODO: add more parameters
    }),
    execute: async ({ target }) => {
        // TODO: implement the actual action
        return `Action executed on: ${target}`;
    },
});

export const exampleQuery = defineTool({
    name: 'example_query',
    description: 'TODO: describe what this query returns',
    input: z.object({
        filter: z.string().optional().describe('Optional filter'),
    }),
    execute: async ({ filter }) => {
        // TODO: implement the actual query
        return JSON.stringify({ results: [], filter });
    },
});
