import 'server-only';
import * as fsp      from 'node:fs/promises';
import * as os       from 'node:os';
import * as nodePath from 'node:path';
import {
    CodeAnalyzer,
    KnowledgeEngine,
    createProvider,
} from '@backendkit-labs/curator-codex-agent';
import type { CuratorLLMProvider } from '@backendkit-labs/curator-codex-agent';

// ── Transport detection ───────────────────────────────────────────────────────
// If CURATOR_CODEX_URL is set, all calls go to the standalone HTTP service.
// Otherwise, classes are instantiated in-process (dev / single-host mode).

const CURATOR_HTTP = process.env.CURATOR_CODEX_URL?.replace(/\/$/, '');
const CURATOR_KEY  = process.env.CURATOR_CODEX_API_KEY ?? '';

function httpHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        ...(CURATOR_KEY ? { Authorization: `Bearer ${CURATOR_KEY}` } : {}),
    };
}

async function httpPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${CURATOR_HTTP}${path}`, {
        method:  'POST',
        headers: httpHeaders(),
        body:    JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(`curator-codex ${path} → ${res.status}: ${(err as any).message ?? res.statusText}`);
    }
    return res.json() as Promise<T>;
}

// ── Local-mode helpers ────────────────────────────────────────────────────────

function makeProvider(): CuratorLLMProvider {
    const apiKey = process.env.CURATOR_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';
    return createProvider({
        provider: (process.env.CURATOR_PROVIDER ?? 'deepseek') as 'deepseek',
        apiKey,
        model:   process.env.CURATOR_MODEL,
        baseUrl: process.env.CURATOR_BASE_URL,
    });
}

// Module-level cache: persists across Next.js requests in the same process
const engineCache = new Map<string, KnowledgeEngine>();

// ── Public API ────────────────────────────────────────────────────────────────

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

export async function curateFile(
    content:   string,
    fileName:  string,
    vaultPath: string,
): Promise<CurateResult> {
    if (CURATOR_HTTP) {
        return httpPost<CurateResult>('/curator/file', { vaultPath, fileName, content });
    }

    // Local mode
    const tmpDir  = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'vault-ingest-'));
    const tmpFile = nodePath.join(tmpDir, fileName);

    try {
        await fsp.writeFile(tmpFile, content, 'utf-8');

        const analyzer = new CodeAnalyzer({ provider: makeProvider(), vaultPath });
        const result   = await analyzer.analyzeFile(tmpFile, fileName);

        let generatedContent: string | null = null;
        let generatedTitle:   string | null = null;
        let tags:             string[]      = [];
        let area                            = 'general';

        if (result.notesWritten.length > 0) {
            const notePath = result.notesWritten[0];

            generatedContent = await fsp.readFile(notePath, 'utf-8').catch(() => null);

            generatedTitle = nodePath.basename(notePath, '.md')
                .replace(/^\d{4}-\d{2}-\d{2}-/, '')
                .replace(/-/g, ' ');

            const rel   = nodePath.relative(vaultPath, notePath);
            const parts = rel.split(nodePath.sep);
            area = parts.length > 1 ? parts[0] : 'general';

            if (generatedContent) {
                const fmMatch  = generatedContent.match(/^---\n([\s\S]*?)\n---/);
                const tagsLine = fmMatch?.[1].match(/^tags:\s*\[([^\]]*)\]/m);
                if (tagsLine) {
                    tags = tagsLine[1]
                        .split(',')
                        .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
                        .filter(Boolean);
                }
            }
        }

        return { ...result, generatedContent, generatedTitle, tags, area };
    } finally {
        await fsp.rm(tmpDir, { recursive: true }).catch(() => {});
    }
}

export async function searchVault(
    vaultPath: string,
    query:     string,
    topK      = 8,
) {
    if (CURATOR_HTTP) {
        return httpPost<Awaited<ReturnType<KnowledgeEngine['search']>>>(
            '/knowledge/search',
            { vaultPath, query, topK },
        );
    }

    // Local mode
    if (!engineCache.has(vaultPath)) {
        const engine = new KnowledgeEngine(makeProvider(), vaultPath);
        await engine.initialize();
        engineCache.set(vaultPath, engine);
    }
    return engineCache.get(vaultPath)!.search(query, { topK, autoSynthesize: false });
}

export async function reindexVault(vaultPath: string) {
    if (CURATOR_HTTP) {
        return httpPost('/knowledge/reindex', { vaultPath });
    }

    // Local mode
    const engine = engineCache.get(vaultPath)
        ?? new KnowledgeEngine(makeProvider(), vaultPath);
    const result = await engine.reload();
    engineCache.set(vaultPath, engine);
    return result;
}
