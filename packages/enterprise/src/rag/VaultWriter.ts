import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ToolDefinition } from '@backendkit-labs/agent-core';

export interface VaultWriterOptions {
    /** Absolute path to the shared vault directory. */
    vaultPath: string;
    /** Sub-folder for agent-written notes. Default: 'agentes' */
    agentFolder?: string;
}

export interface WriteNoteParams {
    title: string;
    content: string;
    agentId: string;
    tags?: string[];
    description?: string;
}

/**
 * Writes structured Markdown notes to a shared Obsidian vault.
 *
 * Notes use standard YAML frontmatter so the VaultIndexer picks them up
 * on the next incremental index() call, making them immediately searchable
 * by any agent or human that queries the vault.
 */
export class VaultWriter {
    private readonly vaultPath: string;
    private readonly agentFolder: string;

    constructor(opts: VaultWriterOptions) {
        this.vaultPath = opts.vaultPath;
        this.agentFolder = opts.agentFolder ?? 'agentes';
    }

    async writeNote(params: WriteNoteParams): Promise<string> {
        const { title, content, agentId, tags = [], description = '' } = params;

        const date = new Date().toISOString().slice(0, 10);
        const slug = title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 60);

        const filename = `${date}-${slug}.md`;
        const dir = path.join(this.vaultPath, this.agentFolder);
        await fs.mkdir(dir, { recursive: true });

        const tagsLine = tags.length
            ? `[${tags.map(t => `"${t}"`).join(', ')}]`
            : '[]';

        const lines: string[] = [
            '---',
            `title: "${title}"`,
            `author: "agent/${agentId}"`,
            `date: ${date}`,
            `tags: ${tagsLine}`,
        ];
        if (description) lines.push(`description: "${description}"`);
        lines.push('---', '', content);

        const filePath = path.join(dir, filename);
        await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
        return filePath;
    }

    /**
     * Returns a ToolDefinition ready to register with ToolRegistry.
     * The agentId is baked in so audit trails show which agent wrote each note.
     */
    createTool(agentId: string): ToolDefinition {
        const self = this;
        return defineTool({
            name: 'write_knowledge',
            description:
                "Write a new note to the organization's shared knowledge vault. " +
                'Use this to record findings, decisions, resolved problems, or any knowledge ' +
                'worth sharing with other agents and team members. ' +
                'Notes are indexed automatically and become searchable via search_knowledge.',
            input: z.object({
                title: z.string().describe('Short descriptive title for the note'),
                content: z.string().describe(
                    'Note body in Markdown. Use ## headings for sections. ' +
                    'Be specific — this will be retrieved by semantic search.',
                ),
                tags: z.array(z.string()).default([]).describe(
                    'Domain tags, e.g. ["función/arquitectura", "stack/typescript", "área/rag"]',
                ),
                description: z.string().optional().describe(
                    'One-line summary shown in search results',
                ),
            }),
            execute: async ({ title, content, tags, description }) => {
                const filePath = await self.writeNote({ title, content, agentId, tags, description });
                return `Knowledge saved to vault: ${path.basename(filePath)}`;
            },
        });
    }
}
