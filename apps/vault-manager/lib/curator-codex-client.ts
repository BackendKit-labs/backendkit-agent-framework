import 'server-only';

// curator-codex-agent fue eliminado del monorepo.
// Estas funciones lanzan un error controlado hasta que el agente sea re-integrado.

export interface CurateResult {
    notesWritten:     string[];
    notesSkipped:     string[];
    errors:           string[];
    generatedContent: string | null;
    generatedTitle:   string | null;
    tags:             string[];
    area:             string;
    durationMs:       number;
}

/**
 * Forma de un resultado del buscador del curator: es la de RagSearchResult en
 * packages/curator-codex-agent/src/knowledge/rag-provider.ts (lo que devuelve KnowledgeEngine.search), y la que
 * consumen app/api/search/route.ts y vault-browser.tsx (relevance, sourcePath).
 */
export interface SearchResult {
    results: { title: string; content: string; relevance: number; sourcePath: string; sourceRef?: string }[];
    synthesized?: string | null;
}

export interface ReindexResult {
    indexed: number;
    skipped: number;
    durationMs: number;
}

export class CuratorUnavailableError extends Error {
    readonly status = 503;
    constructor() {
        super('curator-codex-agent no disponible — funcionalidad pendiente de re-integración');
    }
}

export async function curateFile(
    _content:   string,
    _fileName:  string,
    _vaultPath: string,
): Promise<CurateResult> {
    throw new CuratorUnavailableError();
}

export async function searchVault(
    _vaultPath: string,
    _query:     string,
    _topK      = 8,
): Promise<SearchResult> {
    throw new CuratorUnavailableError();
}

export async function reindexVault(_vaultPath: string): Promise<ReindexResult> {
    throw new CuratorUnavailableError();
}
