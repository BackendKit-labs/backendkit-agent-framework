import { randomUUID } from 'crypto';
import type { MemoryStoreBackend, Pattern, ProceduralConfig, RetentionConfig, StoredRecord } from './types';
import { InMemoryStore } from './stores/InMemoryStore';
import { JsonFileStore } from './stores/JsonFileStore';
import { keywordScore } from './scoring';

/** Patterns kept when `retention.maxPatterns` is not set. */
export const DEFAULT_MAX_PATTERNS = 1_000;

interface PatternRecord extends StoredRecord {
    trigger: string;
    action: string;
    outcome: 'success' | 'failure';
    occurrences: number;
    lastSeen: string; // ISO
}

/**
 * Procedural memory — learned patterns from agent outcomes.
 *
 * Agents call learnPattern() after a task succeeds or fails. On the next
 * relevant task, getRelevantPatterns() retrieves matching heuristics and
 * buildContextBlock() formats them for injection into the system prompt.
 */
export class ProceduralMemory {
    private readonly backend: MemoryStoreBackend;
    private readonly maxPatterns: number;

    constructor(cfg: ProceduralConfig = {}, retention: RetentionConfig = {}) {
        this.maxPatterns = retention.maxPatterns ?? DEFAULT_MAX_PATTERNS;
        this.backend = cfg.provider === 'json' && cfg.path
            ? new JsonFileStore(cfg.path)
            : new InMemoryStore();
    }

    /**
     * Record that a particular (trigger → action) pair produced the given outcome.
     * Repeated calls for the same trigger+action increment the occurrence counter.
     */
    learnPattern(trigger: string, action: string, outcome: 'success' | 'failure'): void {
        const all = this.backend.getAll() as PatternRecord[];
        const existing = all.find(r =>
            r.trigger.toLowerCase() === trigger.toLowerCase() &&
            r.action.toLowerCase() === action.toLowerCase() &&
            r.outcome === outcome,
        );

        if (existing) {
            this.backend.upsert(existing.id, {
                ...existing,
                occurrences: existing.occurrences + 1,
                lastSeen: new Date().toISOString(),
            });
        } else {
            this.backend.insert({
                id: randomUUID(),
                trigger,
                action,
                outcome,
                occurrences: 1,
                lastSeen: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            });
            this.prune();
        }
    }

    /** Over the cap, drops the patterns that earned the least: fewest confirmations, then longest unseen. */
    private prune(): void {
        if (this.maxPatterns === Infinity || this.backend.count() <= this.maxPatterns) return;
        const all = this.backend.getAll() as PatternRecord[];
        const doomed = [...all]
            .sort((a, b) => a.occurrences - b.occurrences || a.lastSeen.localeCompare(b.lastSeen))
            .slice(0, all.length - this.maxPatterns)
            .map(r => r.id);
        if (doomed.length > 0) this.backend.deleteByIds(doomed);
    }

    /** Return patterns whose trigger keywords overlap with the given context. */
    getRelevantPatterns(context: string, limit = 5): Pattern[] {
        return (this.backend.getAll() as PatternRecord[])
            .map(r => ({ ...toPattern(r), score: keywordScore(context, r.trigger) }))
            .filter(p => (p.score ?? 0) > 0)
            .sort((a, b) => {
                // Prefer successful patterns and higher occurrence counts
                const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
                if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
                if (a.outcome !== b.outcome) return a.outcome === 'success' ? -1 : 1;
                return b.occurrences - a.occurrences;
            })
            .slice(0, limit);
    }

    /**
     * Format relevant patterns as a markdown block suitable for system prompt injection.
     * Returns an empty string if no patterns match.
     */
    buildContextBlock(context: string): string {
        const patterns = this.getRelevantPatterns(context, 6);
        if (patterns.length === 0) return '';

        const successes = patterns.filter(p => p.outcome === 'success');
        const failures = patterns.filter(p => p.outcome === 'failure');

        const lines: string[] = ['## Learned Patterns'];
        if (successes.length > 0) {
            lines.push('**What works:**');
            for (const p of successes) {
                lines.push(`- When ${p.trigger}: ${p.action} (confirmed ${p.occurrences}×)`);
            }
        }
        if (failures.length > 0) {
            lines.push('**What to avoid:**');
            for (const p of failures) {
                lines.push(`- When ${p.trigger}: avoid "${p.action}" (failed ${p.occurrences}×)`);
            }
        }
        return lines.join('\n');
    }

    count(): number { return this.backend.count(); }
}

function toPattern(r: PatternRecord): Pattern {
    return {
        id: r.id,
        trigger: r.trigger,
        action: r.action,
        outcome: r.outcome,
        occurrences: r.occurrences,
        lastSeen: new Date(r.lastSeen),
    };
}
