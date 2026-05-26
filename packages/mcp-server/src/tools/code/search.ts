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
    const sanitized = query.trim().replace(/[^a-zA-Z0-9_\-. ]/g, ' ').trim();
    if (!sanitized) return [];

    const terms = sanitized.split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    let rows: SearchResult[];
    try {
        // Multi-word: try AND first, fall back to OR so partial matches surface
        rows = store.search(sanitized, limit);
        if (rows.length === 0 && terms.length > 1) {
            rows = store.search(terms.join(' OR '), limit);
        }
    } catch {
        try {
            rows = store.search(terms.join(' OR '), limit);
        } catch {
            rows = [];
        }
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
