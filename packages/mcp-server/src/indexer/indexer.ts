import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { detectLanguage, registeredExtensions } from './languages/index';
import { parseFile } from './parser';
import { GraphStore, nodeId } from './graph-store';
import type { NodeRow, EdgeRow } from './graph-store';

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out']);

function contentHash(content: string): string {
    return createHash('sha1').update(content).digest('hex');
}

function qualifiedName(filePath: string, name: string, cwd: string): string {
    const rel = path.relative(cwd, filePath).replace(/\\/g, '/');
    return `${rel}::${name}`;
}

/** Files read and parsed at the same time by indexDirectory. Each holds a file's text and AST in memory. */
const DEFAULT_INDEX_CONCURRENCY = 16;

export class CodeIndexer {
    constructor(
        private readonly store: GraphStore,
        private readonly cwd: string,
        private readonly opts: { concurrency?: number } = {},
    ) {}

    async indexFile(filePath: string): Promise<{ indexed: boolean; symbols: number }> {
        const config = detectLanguage(filePath);
        if (!config) return { indexed: false, symbols: 0 };

        let content: string;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch {
            return { indexed: false, symbols: 0 };
        }

        const hash = contentHash(content);
        if (this.store.getFileHash(filePath) === hash) {
            return { indexed: false, symbols: 0 };
        }

        const parsed = await parseFile(content, config);

        // Build nodes — symbols + imports (imports stored as kind='import' for stack detection)
        const importNodes: Omit<NodeRow, 'updated_at'>[] = parsed.imports.map(imp => ({
            id: nodeId(filePath, imp.source, imp.line),
            name: imp.source,
            qualified_name: imp.source,
            kind: 'import',
            language: config.name,
            file_path: filePath,
            start_line: imp.line,
            end_line: imp.line,
            signature: `import "${imp.source}"`,
            exported: 0,
        }));

        const nodes: Omit<NodeRow, 'updated_at'>[] = parsed.symbols.map(sym => ({
            id: nodeId(filePath, sym.name, sym.startLine),
            name: sym.name,
            qualified_name: qualifiedName(filePath, sym.name, this.cwd),
            kind: sym.kind,
            language: config.name,
            file_path: filePath,
            start_line: sym.startLine,
            end_line: sym.endLine,
            signature: sym.signature,
            exported: sym.exported ? 1 : 0,
        }));

        // Build edges: calls
        const edges: EdgeRow[] = [];
        for (const sym of parsed.symbols) {
            const srcId = nodeId(filePath, sym.name, sym.startLine);
            for (const call of parsed.calls) {
                if (call.line >= sym.startLine && call.line <= sym.endLine) {
                    // self-calls excluded
                    if (call.callee === sym.name) continue;
                    // target node might not be indexed yet — use a placeholder target
                    const targetPlaceholder = nodeId(filePath, call.callee, 0);
                    edges.push({
                        source_id: srcId,
                        target_id: targetPlaceholder,
                        kind: 'calls',
                        file_path: filePath,
                        line: call.line,
                    });
                }
            }
        }

        // Write atomically: clear old + insert new
        this.store.removeNodesForFile(filePath);
        this.store.removeEdgesForFile(filePath);
        this.store.upsertNodes([...nodes, ...importNodes]);
        this.store.upsertEdges(edges);
        this.store.upsertFile(filePath, config.name, hash, nodes.length);

        return { indexed: true, symbols: nodes.length };
    }

    removeFile(filePath: string): void {
        this.store.removeFile(filePath);
    }

    async indexDirectory(dir: string): Promise<{ files: number; symbols: number }> {
        const files = await this.collectFiles(dir);
        let totalSymbols = 0;
        let indexedFiles = 0;

        // A bounded pool, not Promise.all over every file: a large repo would otherwise open every file
        // and hold every AST at once (file descriptors and memory spike at startup).
        const limit = Math.max(1, this.opts.concurrency ?? DEFAULT_INDEX_CONCURRENCY);
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < files.length) {
                const result = await this.indexFile(files[next++]);
                if (result.indexed) {
                    indexedFiles++;
                    totalSymbols += result.symbols;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));

        return { files: indexedFiles, symbols: totalSymbols };
    }

    private async collectFiles(dir: string): Promise<string[]> {
        const extensions = new Set(registeredExtensions());
        const result: string[] = [];

        async function walk(current: string): Promise<void> {
            let entries: string[];
            try {
                entries = await fs.readdir(current);
            } catch {
                return;
            }
            for (const name of entries) {
                const fullPath = path.join(current, name);
                let stat;
                try { stat = await fs.stat(fullPath); } catch { continue; }
                if (stat.isDirectory()) {
                    if (!IGNORE_DIRS.has(name)) await walk(fullPath);
                } else if (stat.isFile()) {
                    const ext = name.slice(name.lastIndexOf('.'));
                    if (extensions.has(ext)) result.push(fullPath);
                }
            }
        }

        await walk(dir);
        return result;
    }
}
