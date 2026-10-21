import { defineTool, z } from '../tools/defineTool';
import type { ToolDefinition } from '../types';
import type { EpisodicMemory } from './EpisodicMemory';
import type { SemanticMemory } from './SemanticMemory';
import type { ProceduralMemory } from './ProceduralMemory';

export function buildMemoryTools(
    episodic: EpisodicMemory,
    semantic: SemanticMemory,
    procedural: ProceduralMemory,
): ToolDefinition[] {
    return [
        defineTool({
            name: 'memory_remember',
            description: 'Store an experience or observation in long-term episodic memory.',
            input: z.object({
                content: z.string().describe('What to remember'),
                tags:    z.array(z.string()).default([]).describe('Optional tags (e.g. ["deploy", "error", "pr-123"])'),
            }),
            execute: async ({ content, tags }) => {
                const id = episodic.remember(content, tags);
                return `Stored in episodic memory (id: ${id}). Total episodes: ${episodic.count()}.`;
            },
        }),

        defineTool({
            name: 'memory_recall',
            concurrencySafe: true,
            description: 'Search episodic memory for past experiences relevant to a query.',
            input: z.object({
                query: z.string().describe('What to search for'),
                limit: z.number().int().min(1).max(20).default(5),
            }),
            execute: async ({ query, limit }) => {
                const episodes = episodic.recall(query, limit);
                if (episodes.length === 0) return 'No relevant episodes found.';
                return episodes.map(e =>
                    `[${e.createdAt.toISOString().slice(0, 10)}${e.tags.length ? ` #${e.tags.join(' #')}` : ''}] ${e.content}`
                ).join('\n');
            },
        }),

        defineTool({
            name: 'memory_save_knowledge',
            description: 'Store a piece of knowledge or decision in semantic memory for future retrieval.',
            input: z.object({
                content:  z.string().describe('Knowledge to store'),
                metadata: z.record(z.string()).default({}).describe('Optional key-value metadata'),
            }),
            execute: async ({ content, metadata }) => {
                const id = await semantic.index(content, metadata);
                return `Stored in semantic memory (id: ${id}). Total entries: ${semantic.count()}.`;
            },
        }),

        defineTool({
            name: 'memory_search_knowledge',
            concurrencySafe: true,
            description: 'Search semantic memory for relevant knowledge or past decisions.',
            input: z.object({
                query: z.string().describe('What to search for'),
                limit: z.number().int().min(1).max(10).default(5),
            }),
            execute: async ({ query, limit }) => {
                const results = await semantic.search(query, limit);
                if (results.length === 0) return 'No relevant knowledge found.';
                return results.map(k => `[score=${(k.score ?? 0).toFixed(2)}] ${k.content}`).join('\n');
            },
        }),

        defineTool({
            name: 'memory_learn_pattern',
            description: 'Record what worked or failed so future runs can use this knowledge.',
            input: z.object({
                trigger: z.string().describe('When this situation/context occurs'),
                action:  z.string().describe('The action taken'),
                outcome: z.enum(['success', 'failure']).describe('Whether the action worked'),
            }),
            execute: async ({ trigger, action, outcome }) => {
                procedural.learnPattern(trigger, action, outcome);
                return `Pattern recorded: when "${trigger}" → "${action}" [${outcome}].`;
            },
        }),
    ];
}
