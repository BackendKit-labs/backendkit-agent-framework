// transformers-embedder spawns worker threads and uses import.meta (ESM-only): replace it.
const embedderInit = jest.fn();
jest.mock('../knowledge/transformers-embedder.js', () => ({
    TransformersEmbedder: jest.fn().mockImplementation(() => ({ init: embedderInit })),
}));

// The enterprise RAG provider owns the vector store; fake just the surface rag-provider touches.
const ragIndex = jest.fn();
const embedOne = jest.fn();
const storeSearch = jest.fn();
let ragOpts: Record<string, unknown> = {};
jest.mock('@backendkit-labs/agent-enterprise', () => ({
    ObsidianRAGProvider: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
        ragOpts = opts;
        return { index: ragIndex, embedder: { embedOne }, store: { search: storeSearch } };
    }),
}));

jest.mock('@backendkit-labs/infra', () => ({
    bkPaths: { ragIndex: (name: string) => `/idx/${name}.json` },
}));

import { CuratorRagProvider } from '../knowledge/rag-provider.js';
import { KnowledgeEngine } from '../knowledge/engine.js';
import type { CuratorLLMProvider } from '../providers/types.js';

const ENV = ['CODEX_INDEX_PACING_MS', 'CODEX_INDEX_STAGE_SIZE', 'CODEX_INDEX_STAGE_PACING_MS', 'CODEX_EMBED_MODEL'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    jest.clearAllMocks();
    ragIndex.mockResolvedValue({ indexed: 4, removed: 1 });
    embedOne.mockResolvedValue([0.1, 0.2]);
    storeSearch.mockReturnValue([]);
});
afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const chunk = (title: string, score: number, extra: Record<string, unknown> = {}) => ({
    score, chunk: { title, text: `${title} body`, filePath: `/v/${title}.md`, metadata: { sourceRef: 'ref.md' }, ...extra },
});

describe('CuratorRagProvider', () => {
    it('derives the index path from the vault folder name and exposes it in stats', async () => {
        const rag = new CuratorRagProvider('/data/my-vault');
        expect(await rag.getStats()).toEqual({ indexed: false, vaultPath: '/data/my-vault', indexPath: '/idx/my-vault.json' });
        expect(ragOpts).toMatchObject({ vaultPath: '/data/my-vault', indexPath: '/idx/my-vault.json', topK: 5, minScore: 0.1 });
    });

    it('applies valid pacing env vars and ignores invalid ones', () => {
        process.env.CODEX_INDEX_PACING_MS = '250';
        process.env.CODEX_INDEX_STAGE_SIZE = '0';          // must be > 0 → ignored
        process.env.CODEX_INDEX_STAGE_PACING_MS = 'abc';   // NaN → ignored
        new CuratorRagProvider('/v');
        expect(ragOpts.batchPacingMs).toBe(250);
        expect(ragOpts.stageSize).toBeUndefined();
        expect(ragOpts.stagePacingMs).toBeUndefined();
    });

    it('indexVault maps removed → updated and flips the indexed flag', async () => {
        const rag = new CuratorRagProvider('/v');
        expect(await rag.indexVault()).toEqual({ indexed: 4, updated: 1 });
        expect((await rag.getStats()).indexed).toBe(true);
    });

    it('coalesces concurrent indexVault calls into one pass', async () => {
        let release!: () => void;
        ragIndex.mockImplementationOnce(() => new Promise(res => { release = () => res({ indexed: 2, removed: 0 }); }));
        const rag = new CuratorRagProvider('/v');
        const a = rag.indexVault();
        const b = rag.indexVault();
        release();
        expect(await a).toEqual(await b);
        expect(ragIndex).toHaveBeenCalledTimes(1);
    });

    it('wraps indexing failures and allows a retry afterwards', async () => {
        ragIndex.mockRejectedValueOnce(new Error('disk full'));
        const rag = new CuratorRagProvider('/v');
        await expect(rag.indexVault()).rejects.toThrow('RAG indexing failed: disk full');
        await expect(rag.indexVault()).resolves.toEqual({ indexed: 4, updated: 1 });
    });

    it('search auto-indexes once, filters by minScore and maps chunks', async () => {
        storeSearch.mockReturnValue([chunk('Alta', 0.9), chunk('Baja', 0.05), { score: 0.5, chunk: {} }]);
        const rag = new CuratorRagProvider('/v');
        const res = await rag.search('vacaciones', { topK: 3 });
        expect(ragIndex).toHaveBeenCalledTimes(1);
        expect(embedOne).toHaveBeenCalledWith('vacaciones');
        expect(storeSearch).toHaveBeenCalledWith([0.1, 0.2], 3);
        expect(res).toEqual([
            { title: 'Alta', content: 'Alta body', relevance: 0.9, sourcePath: '/v/Alta.md', sourceRef: 'ref.md' },
            { title: 'Untitled', content: '', relevance: 0.5, sourcePath: '', sourceRef: undefined },
        ]);
        await rag.search('otra');
        expect(ragIndex).toHaveBeenCalledTimes(1); // already indexed
    });

    it('honours a custom minScore and wraps search failures', async () => {
        storeSearch.mockReturnValue([chunk('A', 0.4), chunk('B', 0.6)]);
        const rag = new CuratorRagProvider('/v');
        expect((await rag.search('q', { minScore: 0.5 })).map(r => r.title)).toEqual(['B']);
        embedOne.mockRejectedValueOnce(new Error('worker died'));
        await expect(rag.search('q')).rejects.toThrow('RAG search failed: worker died');
    });

    it('reload keeps serving the index (does not reset the indexed flag)', async () => {
        const rag = new CuratorRagProvider('/v');
        await rag.indexVault();
        await rag.reload();
        expect((await rag.getStats()).indexed).toBe(true);
        expect(ragIndex).toHaveBeenCalledTimes(2);
    });

    it('delegates initEmbedder to the embedder', async () => {
        embedderInit.mockResolvedValue({ alreadyCached: true });
        expect(await new CuratorRagProvider('/v').initEmbedder()).toEqual({ alreadyCached: true });
    });
});

describe('KnowledgeEngine', () => {
    const llm = (reply: string): CuratorLLMProvider & { calls: number } => {
        const p = { calls: 0, async complete() { p.calls++; return reply; } };
        return p;
    };

    it('initializes lazily on the first search and returns structured results', async () => {
        storeSearch.mockReturnValue([chunk('Doc', 0.8)]);
        const engine = new KnowledgeEngine(llm('{}'), '/v');
        expect((await engine.getStats()).initialized).toBe(false);
        const res = await engine.search('q');
        expect(res).toMatchObject({ query: 'q', totalResults: 1, synthesized: undefined });
        expect(res.results[0].title).toBe('Doc');
        expect((await engine.getStats()).initialized).toBe(true);
        expect(ragIndex).toHaveBeenCalledTimes(1);
    });

    it('does not call the LLM unless autoSynthesize is true', async () => {
        storeSearch.mockReturnValue([chunk('Doc', 0.8)]);
        const provider = llm('{}');
        await new KnowledgeEngine(provider, '/v').search('q');
        expect(provider.calls).toBe(0);
    });

    it('reload reports indexed/updated and marks the engine initialized', async () => {
        const engine = new KnowledgeEngine(llm('{}'), '/v');
        const r = await engine.reload();
        expect(r).toMatchObject({ indexed: 4, updated: 1 });
        expect((await engine.getStats()).initialized).toBe(true);
    });

    it('serializes initialize and reload so index passes never overlap', async () => {
        let running = 0, maxRunning = 0;
        ragIndex.mockImplementation(async () => {
            running++; maxRunning = Math.max(maxRunning, running);
            await new Promise(r => setTimeout(r, 15));
            running--;
            return { indexed: 1, removed: 0 };
        });
        const engine = new KnowledgeEngine(llm('{}'), '/v');
        await Promise.all([engine.initialize(), engine.reload(), engine.reload()]);
        expect(maxRunning).toBe(1);
    });

    it('a failed index pass does not poison the queue for the next call', async () => {
        ragIndex.mockRejectedValueOnce(new Error('boom'));
        const engine = new KnowledgeEngine(llm('{}'), '/v');
        await expect(engine.initialize()).rejects.toThrow('RAG indexing failed: boom');
        await expect(engine.reload()).resolves.toMatchObject({ indexed: 4 });
    });

    it('delegates initEmbedder', async () => {
        embedderInit.mockResolvedValue({ alreadyCached: false });
        expect(await new KnowledgeEngine(llm('{}'), '/v').initEmbedder()).toEqual({ alreadyCached: false });
    });
});
