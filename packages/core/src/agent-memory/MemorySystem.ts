import type { ToolDefinition } from '../types';
import { EpisodicMemory } from './EpisodicMemory';
import { SemanticMemory } from './SemanticMemory';
import { ProceduralMemory } from './ProceduralMemory';
import { buildMemoryTools } from './tools';
import type { MemorySystemConfig } from './types';

/**
 * Unified facade for the three-tier agent memory system.
 *
 * - episodic:   time-ordered log of experiences (recall by keyword or tag)
 * - semantic:   knowledge base (recall by keyword or vector similarity)
 * - procedural: learned patterns from successes and failures
 *
 * Use buildContextBlock() to inject relevant memories into system prompts,
 * and getTools() to register the memory tools with the agent engine.
 *
 * @example
 * const memory = createMemorySystem({
 *   episodic:   { provider: 'json', path: '~/.bk/memory/episodes.json' },
 *   semantic:   { provider: 'json', path: '~/.bk/memory/knowledge.json', embedFn: myEmbedder },
 *   procedural: { provider: 'json', path: '~/.bk/memory/patterns.json' },
 *   retention:  { maxEpisodes: 1000, summarizeAfter: 100, summarizeFn: myLLMSummarizer },
 * });
 */
export class MemorySystem {
    readonly episodic: EpisodicMemory;
    readonly semantic: SemanticMemory;
    readonly procedural: ProceduralMemory;

    constructor(private readonly config: MemorySystemConfig = {}) {
        this.episodic   = new EpisodicMemory(config.episodic, config.retention);
        this.semantic   = new SemanticMemory(config.semantic, config.retention);
        this.procedural = new ProceduralMemory(config.procedural, config.retention);
    }

    /**
     * Build a markdown context block combining relevant memories from all three tiers.
     * Inject the result into agent system prompts for in-context retrieval.
     */
    async buildContextBlock(query: string): Promise<string> {
        const parts: string[] = [];

        const recent = this.episodic.recall(query, 5);
        if (recent.length > 0) {
            parts.push('## Relevant Past Experiences');
            for (const e of recent) {
                const date = e.createdAt.toISOString().slice(0, 10);
                const tagStr = e.tags.length ? ` [${e.tags.join(', ')}]` : '';
                parts.push(`- ${date}${tagStr}: ${e.content}`);
            }
        }

        const knowledge = await this.semantic.search(query, 3);
        if (knowledge.length > 0) {
            parts.push('## Relevant Knowledge');
            for (const k of knowledge) {
                parts.push(`- ${k.content}`);
            }
        }

        const procedural = this.procedural.buildContextBlock(query);
        if (procedural) parts.push(procedural);

        return parts.join('\n\n');
    }

    /** Returns pre-built ToolDefinitions to register with the agent engine. */
    getTools(): ToolDefinition[] {
        return buildMemoryTools(this.episodic, this.semantic, this.procedural);
    }
}

/** Factory shorthand for MemorySystem. */
export function createMemorySystem(config?: MemorySystemConfig): MemorySystem {
    return new MemorySystem(config);
}
