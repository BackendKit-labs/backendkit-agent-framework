import * as fs   from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ToolDefinition } from '@backendkit-labs/agent-core';
import { retry } from '@backendkit-labs/retry';

export interface VaultWriterOptions {
    /** Absolute path to the shared vault directory. */
    vaultPath: string;
    /** Sub-folder for agent-written notes. Default: 'agentes' */
    agentFolder?: string;
}

/** Largest note an agent may write, in characters. */
export const MAX_NOTE_CHARS = 200_000;

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
        if (content.length > MAX_NOTE_CHARS) throw new Error(`The note is too long (${content.length} characters; the limit is ${MAX_NOTE_CHARS}).`);

        const date = new Date().toISOString().slice(0, 10);
        const slug = title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 60) || 'nota';

        const baseName = `${date}-${slug}`;
        const dir      = path.join(this.vaultPath, this.agentFolder);
        // agentFolder can be built from outside input (a flow id, a run id): the note must stay inside the vault
        const fromVault = path.relative(path.resolve(this.vaultPath), path.resolve(dir));
        if (fromVault.startsWith('..') || path.isAbsolute(fromVault)) {
            throw new Error(`Unsafe agentFolder ${JSON.stringify(this.agentFolder)}: it resolves outside the vault.`);
        }
        await fs.mkdir(dir, { recursive: true });

        const body = buildNote({ title, content, agentId, tags, description, related_notes, date });

        // A note is never overwritten: the same title on the same day gets a number (the file is created with `wx`, which fails if it exists).
        for (let n = 1; n <= 1000; n++) {
            const filePath = path.join(dir, n === 1 ? `${baseName}.md` : `${baseName}-${n}.md`);
            try {
                await withFileLock(filePath, () => fs.writeFile(filePath, body, { encoding: 'utf-8', flag: 'wx' }));
                return filePath;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
            }
        }
        throw new Error(`Could not find a free name for the note "${title}" after 1000 tries`);
    }

    /**
     * Returns a ToolDefinition ready to register with ToolRegistry.
     * The agentId is baked in so audit trails show which agent wrote each note.
     */
    createTool(agentId: string): ToolDefinition {
        return this.createToolFor(() => agentId, () => this);
    }

    /**
     * A write tool for several agents: each call is written as the agent that made it, to the writer `writerFor` returns for that
     * agent (a folder per department). `agentIdOf` reads who is calling from the call's context.
     */
    createToolFor(agentIdOf: (ctx: { agentId?: string }) => string, writerFor: (agentId: string) => VaultWriter): ToolDefinition {
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
            execute: async ({ title, content, tags, description, related_notes }, ctx) => {
                const agentId = agentIdOf(ctx as { agentId?: string });
                const filePath = await writerFor(agentId).writeNote({ title, content, agentId, tags, description, related_notes });
                return `Knowledge saved to vault: ${path.basename(filePath)}`;
            },
        });
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A YAML double-quoted scalar. JSON string escaping is valid YAML, so a quote or a newline cannot break out of the value. */
function yamlString(value: string): string {
    return JSON.stringify(value);
}

function buildNote(p: WriteNoteParams & { date: string }): string {
    const tagsLine = p.tags?.length
        ? `[${p.tags.map(yamlString).join(', ')}]`
        : '[]';

    const lines: string[] = [
        '---',
        `title: ${yamlString(p.title)}`,
        `author: ${yamlString(`agent/${p.agentId}`)}`,
        `date: ${p.date}`,
        `tags: ${tagsLine}`,
    ];
    if (p.description) lines.push(`description: ${yamlString(p.description)}`);
    if (p.related_notes?.length) {
        lines.push(`related_notes: [${p.related_notes.map(yamlString).join(', ')}]`);
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
    const lockPath = `${filePath}.lock`;
    const maxAttempts = 10;

    // A lock left by a process that died would block this note for good: one older than a minute is nobody's.
    try {
        const info = await fs.stat(lockPath);
        if (Date.now() - info.mtimeMs > 60_000) await fs.unlink(lockPath).catch(() => {});
    } catch { /* no lock: the usual case */ }

    // wx = O_WRONLY | O_CREAT | O_EXCL — fails atomically if lock exists
    const acquired = await retry(() => fs.open(lockPath, 'wx'), {
        maxAttempts,
        backoff: { type: 'exponential', baseDelay: 50, jitter: 'full' },
        // lock contention (EEXIST) is a plain Error, not an HTTP-like failure: always retry
        retryIf: () => true,
    });
    if (!acquired.ok) {
        throw new Error(`Could not acquire lock for ${path.basename(filePath)} after ${maxAttempts} attempts`);
    }
    const fd: fsSync.promises.FileHandle | null = acquired.value;

    try {
        return await fn();
    } finally {
        if (fd) {
            await fd.close().catch(() => {});
            await fs.unlink(lockPath).catch(() => {});
        }
    }
}

