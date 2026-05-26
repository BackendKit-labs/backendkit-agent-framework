import * as fs from 'fs/promises';
import type { GraphStore, NodeRow } from '../../indexer/graph-store';
import { codeSearch } from './search';

export interface ContextSymbol {
    name: string;
    kind: string;
    language: string;
    filePath: string;
    startLine: number;
    endLine: number;
    signature: string;
    snippet: string;
    calledBy: string[];
    calls: string[];
}

export interface CodeContext {
    task: string;
    symbols: ContextSymbol[];
    stats: { searched: number; returned: number };
}

async function readSnippet(filePath: string, startLine: number, endLine: number): Promise<string> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const from = Math.max(0, startLine - 1);
        const to = Math.min(lines.length, endLine);
        return lines.slice(from, to).join('\n');
    } catch {
        return '';
    }
}

function resolveNodeName(store: GraphStore, nodeId: string): string {
    return store.getNode(nodeId)?.name ?? nodeId.slice(0, 8);
}

export async function codeContext(
    task: string,
    store: GraphStore,
    maxSymbols = 10,
): Promise<CodeContext> {
    const results = codeSearch(task, store, maxSymbols * 2);

    // Deduplicate by file+name, keep highest ranked
    const seen = new Set<string>();
    const top: typeof results = [];
    for (const r of results) {
        const key = `${r.filePath}::${r.name}`;
        if (!seen.has(key)) {
            seen.add(key);
            top.push(r);
            if (top.length >= maxSymbols) break;
        }
    }

    const symbols: ContextSymbol[] = await Promise.all(
        top.map(async r => {
            const [snippet, outEdges, inEdges] = await Promise.all([
                readSnippet(r.filePath, r.startLine, r.endLine),
                Promise.resolve(store.getOutgoingEdges(r.id)),
                Promise.resolve(store.getIncomingEdges(r.id)),
            ]);

            return {
                name: r.name,
                kind: r.kind,
                language: r.language,
                filePath: r.filePath,
                startLine: r.startLine,
                endLine: r.endLine,
                signature: r.signature,
                snippet: snippet.slice(0, 2000),
                calls: outEdges.map(e => resolveNodeName(store, e.target_id)),
                calledBy: inEdges.map(e => resolveNodeName(store, e.source_id)),
            };
        }),
    );

    return {
        task,
        symbols,
        stats: { searched: results.length, returned: symbols.length },
    };
}
