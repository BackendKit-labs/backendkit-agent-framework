import type { AgentProfile, ToolDefinition } from '../types';

/**
 * Deferred tools and `tool_search` (SPEC-0030). A deferred tool is left out of the model's tool list until the model finds it by
 * name or description. Searching only looks among tools the agent may already call: finding a tool authorizes nothing.
 */
export const TOOL_SEARCH_NAME = 'tool_search';
export const TOOL_SEARCH_DEFAULT_RESULTS = 5;

/** `crm_find` matches `crm_find` and `crm_*`; a lone `*` matches every tool. */
export function matchesDeferPattern(name: string, patterns: readonly string[]): boolean {
    return patterns.some(p => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));
}

export function isDeferred(tool: ToolDefinition, profile: Pick<AgentProfile, 'deferTools'>): boolean {
    return tool.defer === true || (profile.deferTools !== undefined && matchesDeferPattern(tool.name, profile.deferTools));
}

/** The tool the engine offers to an agent that has deferred tools. The engine fills in `execute` with the agent's own context. */
export function toolSearchDefinition(execute: ToolDefinition['execute']): ToolDefinition {
    return {
        name: TOOL_SEARCH_NAME,
        description:
            'Finds tools that are not listed yet. Describe what you need to do in a few words; the tools that match are returned ' +
            'and become available to call from your next step.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What you need to do, or part of a tool name' } },
            required: ['query'],
        },
        // Searching changes nothing: the default policy lets it through, an explicit one still sees it.
        readOnly: true,
        execute,
    };
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);

/** Word score over name and description: a word in the name weighs more than one in the description. Zero means no match. */
export function scoreTool(queryWords: readonly string[], tool: ToolDefinition): number {
    const nameWords = words(tool.name);
    const name = tool.name.toLowerCase();
    const description = tool.description.toLowerCase();
    let score = 0;
    for (const w of queryWords) {
        if (nameWords.includes(w)) score += 4;
        else if (name.includes(w)) score += 2;
        if (description.includes(w)) score += 1;
    }
    return score;
}

/** The best matches, best first; ties keep the order of `candidates`. */
export function rankTools(query: string, candidates: readonly ToolDefinition[], max: number): ToolDefinition[] {
    const q = words(query);
    return candidates
        .map((tool, i) => ({ tool, i, score: scoreTool(q, tool) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, Math.max(1, max))
        .map(r => r.tool);
}

export function describeFound(found: readonly ToolDefinition[]): string {
    if (found.length === 0) return 'No tool matches. Try other words, or a part of the tool name.';
    const lines = found.map(t => `- ${t.name}: ${t.description.replace(/\s+/g, ' ').slice(0, 200)}`);
    return `${found.length === 1 ? '1 tool is' : `${found.length} tools are`} now available to call:\n${lines.join('\n')}`;
}
