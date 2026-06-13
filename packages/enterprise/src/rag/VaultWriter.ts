import * as fs   from 'fs/promises';
import * as fsSync from 'fs';
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
    related_notes?: string[];
}

/**
 * Writes structured Markdown notes to a shared Obsidian vault.
 *
 * Notes use standard YAML frontmatter so the VaultIndexer picks them up
 * on the next incremental index() call, making them immediately searchable
 * by any agent or human that queries the vault.
 *
 * Concurrent writes are serialized with a per-file lock (wx atomic open)
 * so multiple agents writing simultaneously cannot corrupt each other's notes.
 */
export class VaultWriter {
    private readonly vaultPath:   string;
    private readonly agentFolder: string;

    constructor(opts: VaultWriterOptions) {
        this.vaultPath   = opts.vaultPath;
        this.agentFolder = opts.agentFolder ?? 'agentes';
    }

    async writeNote(params: WriteNoteParams): Promise<string> {
        const { title, content, agentId, tags = [], description = '', related_notes = [] } = params;

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
        const dir      = path.join(this.vaultPath, this.agentFolder);
        await fs.mkdir(dir, { recursive: true });

        const filePath = path.join(dir, filename);
        const body     = buildNote({ title, content, agentId, tags, description, related_notes, date });

        await withFileLock(filePath, () => fs.writeFile(filePath, body, 'utf-8'));
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
                related_notes: z.array(z.string()).default([]).describe(
                    'Titles of related notes in the vault, e.g. ["RAG Pipeline", "Arquitectura de Datos"]. ' +
                    'These are embedded as context so semantic search connects this note to its neighbors.',
                ),
            }),
            execute: async ({ title, content, tags, description, related_notes }) => {
                const filePath = await self.writeNote({ title, content, agentId, tags, description, related_notes });
                return `Knowledge saved to vault: ${path.basename(filePath)}`;
            },
        });
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNote(p: WriteNoteParams & { date: string }): string {
    const tagsLine = p.tags?.length
        ? `[${p.tags.map(t => `"${t}"`).join(', ')}]`
        : '[]';

    const lines: string[] = [
        '---',
        `title: "${p.title}"`,
        `author: "agent/${p.agentId}"`,
        `date: ${p.date}`,
        `tags: ${tagsLine}`,
    ];
    if (p.description) lines.push(`description: "${p.description}"`);
    if (p.related_notes?.length) {
        lines.push(`related_notes: [${p.related_notes.map(n => `"${n}"`).join(', ')}]`);
    }
    lines.push('---', '', p.content);
    return lines.join('\n');
}

/**
 * Serialize writes to the same file path using an adjacent .lock file.
 * Uses O_EXCL (wx flag) for atomic creation — only one process/coroutine
 * can hold the lock at a time. Retries with exponential backoff.
 */
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const lockPath   = `${filePath}.lock`;
    const maxRetries = 10;
    const baseDelay  = 50;

    let fd: fsSync.promises.FileHandle | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // wx = O_WRONLY | O_CREAT | O_EXCL — fails atomically if lock exists
            fd = await fs.open(lockPath, 'wx');
            break;
        } catch {
            if (attempt < maxRetries - 1) {
                await sleep(baseDelay * 2 ** attempt + Math.random() * baseDelay);
            } else {
                throw new Error(`Could not acquire lock for ${path.basename(filePath)} after ${maxRetries} attempts`);
            }
        }
    }

    try {
        return await fn();
    } finally {
        if (fd) {
            await fd.close().catch(() => {});
            await fs.unlink(lockPath).catch(() => {});
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
