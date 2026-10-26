import { randomUUID } from 'crypto';
import type { Episode, EpisodicConfig, MemoryStoreBackend, RetentionConfig, SummarizeFn, StoredRecord } from './types';
import { InMemoryStore } from './stores/InMemoryStore';
import { JsonFileStore } from './stores/JsonFileStore';
import { keywordScore } from './scoring';

interface EpisodeRecord extends StoredRecord {
    content: string;
    tags: string[];
    recallCount: number;
    lastRecalledAt: string | null;
}

/**
 * Episodic memory — a time-ordered log of agent experiences.
 *
 * Supports keyword-based recall and tag filtering. Retention limits and
 * optional LLM-based summarization keep the store from growing unbounded.
 */
export class EpisodicMemory {
    private readonly backend: MemoryStoreBackend;
    private readonly maxEpisodes: number;
    private readonly summarizeAfter: number;
    private readonly summarizeFn?: SummarizeFn;
    private episodesSinceSummary = 0;

    constructor(episodicCfg: EpisodicConfig = {}, retentionCfg: RetentionConfig = {}) {
        this.backend = makeBackend(episodicCfg);
        this.maxEpisodes = retentionCfg.maxEpisodes ?? Infinity;
        this.summarizeAfter = retentionCfg.summarizeAfter ?? Infinity;
        this.summarizeFn = retentionCfg.summarizeFn;
    }

    /** Store an experience. Returns the new episode ID. */
    remember(content: string, tags: string[] = []): string {
        const id = randomUUID();
        this.backend.insert({ id, content, tags, createdAt: new Date().toISOString(), recallCount: 0, lastRecalledAt: null });

        this.episodesSinceSummary++;

        if (this.maxEpisodes < Infinity && this.backend.count() > this.maxEpisodes) {
            // Prune by relevance score — frequently-recalled episodes survive over stale ones.
            const all    = this.backend.getAll() as EpisodeRecord[];
            const sorted = [...all].sort((a, b) => episodeRelevance(b) - episodeRelevance(a));
            const toDelete = sorted.slice(this.maxEpisodes).map(r => r.id);
            if (toDelete.length > 0) this.backend.deleteByIds(toDelete);
        }

        if (this.summarizeFn && this.episodesSinceSummary >= this.summarizeAfter) {
            this.episodesSinceSummary = 0;
            void this.runSummarization();
        }

        return id;
    }

    /** Retrieve episodes most relevant to a text query (keyword overlap). Increments recallCount on matched records. */
    recall(query: string, limit = 10): Episode[] {
        const now = new Date().toISOString();
        const all = this.backend.getAll() as EpisodeRecord[];

        const scored = all
            .map(r => ({ r, score: keywordScore(query, `${r.content} ${r.tags.join(' ')}`) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        // One write for the whole result set, not one per matched episode.
        const touched = scored.map(({ r }) => ({ ...r, recallCount: (r.recallCount ?? 0) + 1, lastRecalledAt: now }));
        if (this.backend.upsertMany) this.backend.upsertMany(touched);
        else for (const t of touched) this.backend.upsert(t.id, t);

        return scored.map(x => ({ ...toEpisode(x.r), score: x.score }));
    }

    /** Retrieve episodes that carry a specific tag, newest first. */
    recallByTag(tag: string, limit = 10): Episode[] {
        return (this.backend.getAll() as EpisodeRecord[])
            .filter(r => r.tags.includes(tag))
            .slice(-limit)
            .map(toEpisode);
    }

    /** Return the N most recently stored episodes. */
    recallRecent(n = 10): Episode[] {
        return (this.backend.getAll() as EpisodeRecord[])
            .slice(-n)
            .map(toEpisode);
    }

    count(): number { return this.backend.count(); }

    // ── Private ────────────────────────────────────────────────────────────────

    private async runSummarization(): Promise<void> {
        const oldestRecords = (this.backend.getAll() as EpisodeRecord[]).slice(0, this.summarizeAfter);
        if (oldestRecords.length === 0 || !this.summarizeFn) return;

        const summary = await this.summarizeFn(oldestRecords.map(toEpisode));
        // The summary replaces what it covers; keeping both would make the store grow by one on every pass.
        this.backend.deleteByIds(oldestRecords.map(r => r.id));
        this.remember(summary, ['summary']);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toEpisode(r: EpisodeRecord): Episode {
    return { id: r.id, content: r.content, tags: r.tags, createdAt: new Date(r.createdAt) };
}

function makeBackend(cfg: EpisodicConfig): MemoryStoreBackend {
    return cfg.provider === 'json' && cfg.path
        ? new JsonFileStore(cfg.path)
        : new InMemoryStore();
}

/**
 * Relevance score for pruning: balances recency with how often the episode has been recalled.
 * Frequently-accessed episodes decay slower than stale ones never retrieved.
 *   recency  = 1 / (1 + daysSince * 0.1)  → halves every ~10 days
 *   utility  = log(1 + recallCount)         → logarithmic utility gain per recall
 */
function episodeRelevance(r: EpisodeRecord): number {
    const daysSince = (Date.now() - new Date(r.createdAt).getTime()) / 86_400_000;
    const recency   = 1 / (1 + daysSince * 0.1);
    const utility   = Math.log1p(r.recallCount ?? 0);
    return recency * 0.6 + utility * 0.4;
}
