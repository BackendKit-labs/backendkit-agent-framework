import * as path from 'node:path';
import * as fs   from 'node:fs';
import { SimpleEmbedder, OllamaEmbedder } from '@backendkit-labs/agent-enterprise';
import type { OrchestratorConfig }         from './config.js';
import { LanceRAGProvider }                from './lance-rag.js';

type RAG = { search: (q: string) => Promise<string> };

/** A built index is reused this long: starting or approving a run used to re-scan and re-index the whole vault. */
const RAG_TTL_MS = 2 * 60_000;
const ragCache = new Map<string, { at: number; built: Promise<RAG | null> }>();

/** Drops the cached indexes (tests, or after the vault is known to have changed). */
export function clearRAGCache(): void { ragCache.clear(); }

export async function buildRAG(
    config:  OrchestratorConfig,
    dataDir: string,
): Promise<RAG | null> {
    const vaultCfg = config.orchestrator.vault;
    if (!vaultCfg) return null;

    const key = JSON.stringify([vaultCfg.path, dataDir, vaultCfg.embedder, vaultCfg.ollama_host, vaultCfg.ollama_model]);
    const hit = ragCache.get(key);
    if (hit && Date.now() - hit.at < RAG_TTL_MS) return hit.built;

    const built = buildRAGUncached(config, dataDir);
    ragCache.set(key, { at: Date.now(), built });
    // A failed build is not worth remembering: the next run tries again.
    built.catch(() => { if (ragCache.get(key)?.built === built) ragCache.delete(key); });
    return built;
}

async function buildRAGUncached(
    config:  OrchestratorConfig,
    dataDir: string,
): Promise<RAG | null> {
    const vaultCfg = config.orchestrator.vault;
    if (!vaultCfg) return null;

    // LanceDB store: .orchestrator/rag-lance/{chunks.lance/}
    // The old JSON index (.orchestrator/rag/vault.json) is left in place and can be deleted manually.
    const dbPath = path.join(dataDir, 'rag-lance');
    fs.mkdirSync(dbPath, { recursive: true });

    const embedder = vaultCfg.embedder === 'ollama'
        ? new OllamaEmbedder({ host: vaultCfg.ollama_host, model: vaultCfg.ollama_model })
        : new SimpleEmbedder();

    const rag = new LanceRAGProvider({
        vaultPath: vaultCfg.path,
        dbPath,
        embedder,
        topK:      5,
        minScore:  0.1,
    });

    await rag.index({ verbose: false });

    return { search: (query: string) => rag.search(query) };
}
