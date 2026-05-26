import type { GraphStore, SearchResult } from '../../indexer/graph-store';

export interface CodeSearchResult {
    id: string;
    name: string;
    qualifiedName: string;
    kind: string;
    language: string;
    filePath: string;
    startLine: number;
    endLine: number;
    signature: string;
    exported: boolean;
}

export function codeSearch(
    query: string,
    store: GraphStore,
    limit = 20,
): CodeSearchResult[] {
    // Sanitize for FTS5 — wrap in quotes if it contains special chars
    const ftsQuery = query.trim().replace(/[^a-zA-Z0-9_\-. ]/g, ' ').trim();
    if (!ftsQuery) return [];

    let rows: SearchResult[];
    try {
        rows = store.search(ftsQuery, limit);
    } catch {
        // FTS5 query might be malformed — fallback to LIKE on name
        rows = store.search(`"${ftsQuery}"`, limit);
    }

    return rows.map(r => ({
        id: r.id,
        name: r.name,
        qualifiedName: r.qualified_name,
        kind: r.kind,
        language: r.language,
        filePath: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        signature: r.signature,
        exported: r.exported === 1,
    }));
}
