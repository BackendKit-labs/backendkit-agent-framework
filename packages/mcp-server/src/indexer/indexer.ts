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

export class CodeIndexer {
    constructor(
        private readonly store: GraphStore,
        private readonly cwd: string,
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

        // Build nodes
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

        // Write atomically: clear old + insert new inside a store transaction
        this.store.removeNodesForFile(filePath);
        this.store.removeEdgesForFile(filePath);
        this.store.upsertNodes(nodes);
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

        await Promise.all(
            files.map(async f => {
                const result = await this.indexFile(f);
                if (result.indexed) {
                    indexedFiles++;
                    totalSymbols += result.symbols;
                }
            }),
        );

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
