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

export interface SearchResult {
    results: { id: string; score: number; title: string; content: string; metadata?: Record<string, unknown> }[];
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
