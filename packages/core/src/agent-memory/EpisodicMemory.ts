import { randomUUID } from 'crypto';
import type { Episode, EpisodicConfig, MemoryStoreBackend, RetentionConfig, SummarizeFn, StoredRecord } from './types';
import { InMemoryStore } from './stores/InMemoryStore';
import { JsonFileStore } from './stores/JsonFileStore';
import { keywordScore } from './scoring';

interface EpisodeRecord extends StoredRecord {
    content: string;
    tags: string[];
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
        this.backend.insert({ id, content, tags, createdAt: new Date().toISOString() });

        this.episodesSinceSummary++;

        if (this.maxEpisodes < Infinity && this.backend.count() > this.maxEpisodes) {
            this.backend.deleteOldest(this.maxEpisodes);
        }

        if (this.summarizeFn && this.episodesSinceSummary >= this.summarizeAfter) {
            this.episodesSinceSummary = 0;
            void this.runSummarization();
        }

        return id;
    }

    /** Retrieve episodes most relevant to a text query (keyword overlap). */
    recall(query: string, limit = 10): Episode[] {
        return (this.backend.getAll() as EpisodeRecord[])
            .map(r => ({ ...toEpisode(r), score: keywordScore(query, `${r.content} ${r.tags.join(' ')}`) }))
            .filter(e => (e.score ?? 0) > 0)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit);
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
        const oldest = (this.backend.getAll() as EpisodeRecord[])
            .slice(0, this.summarizeAfter)
            .map(toEpisode);
        if (oldest.length === 0 || !this.summarizeFn) return;

        const summary = await this.summarizeFn(oldest);
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
