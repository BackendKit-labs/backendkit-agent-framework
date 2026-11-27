import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { randomUUID } from 'crypto';
import type { VectorChunk } from './VectorStore';

const MAX_WORDS_PER_CHUNK = 500;

interface Frontmatter {
    title?: string;
    description?: string;
    tags?: string[] | string;
    semantic_topics?: string[];
    related_notes?: string[];
    [key: string]: unknown;
}

export interface RawChunk {
    filePath: string;
    mtime: number;
    title: string;
    section: string;
    text: string;
    tags: string[];
    description: string;
    /** `agent/<id>` when the note says an agent wrote it. */
    author?: string;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };
    try {
        const meta = yaml.parse(match[1]) as Frontmatter ?? {};
        return { meta, body: match[2] ?? '' };
    } catch {
        return { meta: {}, body: content };
    }
}

function normalizeTags(raw: string[] | string | undefined): string[] {
    if (!Array.isArray(raw)) return raw ? [raw] : [];
    return raw.map(String);
}

function extractArea(tags: string[]): string | undefined {
    return tags.find(t => t.startsWith('área/'))?.replace('área/', '');
}

function extractStack(tags: string[]): string | undefined {
    return tags.find(t => t.startsWith('stack/'))?.replace('stack/', '');
}

function wordCount(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
}

function splitByParagraph(text: string, maxWords: number): string[] {
    const paragraphs = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
        const candidate = current ? `${current}\n\n${para}` : para;
        if (wordCount(candidate) > maxWords && current) {
            chunks.push(current.trim());
            current = para;
        } else {
            current = candidate;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(c => c.length > 0);
}

function chunkBody(body: string): Array<{ section: string; text: string }> {
    const lines = body.split('\n');
    const sections: Array<{ heading: string; lines: string[] }> = [];
    let current: { heading: string; lines: string[] } = { heading: '', lines: [] };

    for (const line of lines) {
        const h2Match = line.match(/^##\s+(.+)/);
        if (h2Match) {
            if (current.lines.join('\n').trim()) sections.push(current);
            current = { heading: h2Match[1].trim(), lines: [] };
        } else {
            current.lines.push(line);
        }
    }
    if (current.lines.join('\n').trim()) sections.push(current);

    const result: Array<{ section: string; text: string }> = [];
    for (const sec of sections) {
        const text = sec.lines.join('\n').trim();
        if (!text) continue;
        if (wordCount(text) <= MAX_WORDS_PER_CHUNK) {
            result.push({ section: sec.heading, text });
        } else {
            const subChunks = splitByParagraph(text, MAX_WORDS_PER_CHUNK);
            subChunks.forEach((sub, i) =>
                result.push({ section: sec.heading ? `${sec.heading} (${i + 1})` : `parte ${i + 1}`, text: sub })
            );
        }
    }
    return result;
}

/** Appends every .md under `dir` to `out`, depth first. One shared array: no copy of the partial result per directory. */
async function collectMdFiles(dir: string, out: string[] = []): Promise<string[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await collectMdFiles(fullPath, out);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        }
    }
    return out;
}

/** stat calls in flight at once while scanning a vault. */
const STAT_CONCURRENCY = 32;

export interface IndexerOptions {
    vaultPath: string;
    /** Subcarpetas a incluir. Si está vacío, escanea todo el vault. */
    folders?: string[];
    /** Tags del frontmatter a excluir (ej. 'skill' para no duplicar con ObsidianProvider). */
    excludeTags?: string[];
    /** Archivos a excluir por nombre (ej. 'MEMORY.md'). */
    excludeFiles?: string[];
    /** Carpetas de primer nivel del vault que no se indexan nunca (aunque esten dentro de `folders` o el vault entero). */
    excludeFolders?: string[];
}

export class VaultIndexer {
    private readonly opts: Required<IndexerOptions>;

    constructor(opts: IndexerOptions) {
        this.opts = {
            vaultPath:    opts.vaultPath,
            folders:      opts.folders      ?? [],
            excludeTags:  opts.excludeTags  ?? ['skill'],
            excludeFiles: opts.excludeFiles ?? [],
            excludeFolders: opts.excludeFolders ?? [],
        };
        // A folder is a part of the vault: `../secrets` or an absolute path would index files outside it (audit C-07).
        for (const f of this.opts.folders) {
            if (!insideVault(this.opts.vaultPath, path.join(this.opts.vaultPath, f))) {
                throw new Error(`VaultIndexer: folder ${JSON.stringify(f)} resolves outside the vault`);
            }
        }
    }

    async getChangedFiles(knownMtimes: Map<string, number>): Promise<{
        toIndex: Array<{ filePath: string; mtime: number }>;
        toRemove: string[];
    }> {
        const allFiles = await this.scanVault();
        const currentPaths = new Set(allFiles.map(f => f.filePath));

        const toIndex = allFiles.filter(f => {
            const known = knownMtimes.get(f.filePath);
            return known === undefined || known < f.mtime;
        });

        const toRemove = [...knownMtimes.keys()].filter(p => !currentPaths.has(p));

        return { toIndex, toRemove };
    }

    async buildChunks(filePath: string, mtime: number): Promise<RawChunk[]> {
        let content: string;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch {
            return [];
        }

        const { meta, body } = parseFrontmatter(content);
        const tags = normalizeTags(meta.tags);

        if (this.opts.excludeTags.some(t => tags.includes(t))) return [];

        const title = meta.title ?? path.basename(filePath, '.md');
        const description = meta.description ?? '';
        const author = typeof meta.author === 'string' && meta.author.startsWith('agent/') ? meta.author : undefined;
        const topicHints = Array.isArray(meta.semantic_topics)
            ? `\n\nTopics: ${(meta.semantic_topics as string[]).join(', ')}`
            : '';
        const relatedHints = Array.isArray(meta.related_notes) && meta.related_notes.length
            ? `\n\nRelated: ${(meta.related_notes as string[]).join(', ')}`
            : '';

        const sections = chunkBody(body + topicHints + relatedHints);
        if (sections.length === 0) return [];

        return sections.map(sec => ({
            filePath,
            mtime,
            title,
            section: sec.section,
            text: `${title}${sec.section ? ` — ${sec.section}` : ''}\n\n${sec.text}`,
            tags,
            description,
            ...(author ? { author } : {}),
        }));
    }

    private async scanVault(): Promise<Array<{ filePath: string; mtime: number }>> {
        const scanDirs = this.opts.folders.length > 0
            ? this.opts.folders.map(f => path.join(this.opts.vaultPath, f))
            : [this.opts.vaultPath];

        const allFiles: Array<{ filePath: string; mtime: number }> = [];
        for (const dir of scanDirs) {
            const mdFiles = (await collectMdFiles(dir))
                .filter(filePath => !this.opts.excludeFiles.some(ex => path.basename(filePath) === ex))
                .filter(filePath => {
                    const top = path.relative(this.opts.vaultPath, filePath).split(/[\\/]/)[0];
                    return !this.opts.excludeFolders.includes(top!);
                });
            // Bounded parallel stat (it was one await per file); the result keeps the directory order.
            for (let i = 0; i < mdFiles.length; i += STAT_CONCURRENCY) {
                const stats = await Promise.all(mdFiles.slice(i, i + STAT_CONCURRENCY).map(async filePath => {
                    try {
                        return { filePath, mtime: (await fs.stat(filePath)).mtimeMs };
                    } catch {
                        return null; // archivo desapareció entre escaneo y stat
                    }
                }));
                for (const st of stats) if (st) allFiles.push(st);
            }
        }
        return allFiles;
    }

    toVectorChunk(raw: RawChunk, embedding: number[]): VectorChunk {
        return {
            id: randomUUID(),
            filePath: raw.filePath,
            title: raw.title,
            section: raw.section,
            text: raw.text,
            embedding,
            metadata: {
                tags: raw.tags,
                description: raw.description,
                mtime: raw.mtime,
                area: extractArea(raw.tags),
                ...(raw.author ? { author: raw.author } : {}),
                stack: extractStack(raw.tags),
            },
        };
    }
}

/** Is `target` the vault or inside it? `..`, an absolute path elsewhere, or another drive are not. */
function insideVault(vault: string, target: string): boolean {
    const rel = path.relative(path.resolve(vault), path.resolve(target));
    return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
