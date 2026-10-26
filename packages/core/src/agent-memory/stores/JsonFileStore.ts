import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteSync } from '../../shared/utils/atomic-write';
import type { MemoryStoreBackend, StoredRecord } from '../types';

/** Appended line that removes records: `{"_del":["id", ...]}`. Every other line is a record (insert or replace). */
interface DeleteLine { _del: string[] }

/** The log is rewritten once it holds this many times more lines than live records (and at least COMPACT_MIN). */
const COMPACT_RATIO = 2;
const COMPACT_MIN = 1_000;

/**
 * Persistent store backed by an append-only log of JSON lines.
 *
 * insert/upsert/delete append one line instead of rewriting the whole file, so n writes cost O(n) in total
 * (the previous array-in-one-file format cost O(n²)). Reads are served from memory. When dead lines pile up
 * the log is compacted with an atomic rewrite (tmp + rename). A line torn by a crash is skipped on load.
 *
 * Files written by the earlier format (one pretty-printed JSON array) are read as before and converted to the
 * log format on first load.
 */
export class JsonFileStore implements MemoryStoreBackend {
    private records: Map<string, StoredRecord> | null = null;
    private logLines = 0;

    constructor(private readonly path: string) {
        mkdirSync(dirname(path), { recursive: true });
    }

    insert(record: StoredRecord): void {
        const map = this.load();
        map.set(record.id, record);
        this.append(JSON.stringify(record));
    }

    upsert(id: string, record: StoredRecord): void {
        const map = this.load();
        map.set(id, record); // an existing id keeps its position, as the in-place replace did
        this.append(JSON.stringify(record));
    }

    getAll(): StoredRecord[] { return [...this.load().values()]; }

    deleteOldest(keepNewest: number): void {
        const map = this.load();
        if (map.size <= keepNewest) return;
        const doomed = [...map.keys()].slice(0, map.size - keepNewest);
        this.remove(doomed);
    }

    deleteByIds(ids: string[]): void {
        const map = this.load();
        const present = ids.filter(id => map.has(id));
        if (present.length > 0) this.remove(present);
    }

    count(): number { return this.load().size; }

    private remove(ids: string[]): void {
        const map = this.load();
        for (const id of ids) map.delete(id);
        this.append(JSON.stringify({ _del: ids } satisfies DeleteLine));
    }

    private append(line: string): void {
        appendFileSync(this.path, line + '\n');
        this.logLines++;
        const live = this.load().size;
        if (this.logLines > Math.max(COMPACT_MIN, live * COMPACT_RATIO)) this.compact();
    }

    private compact(): void {
        const map = this.load();
        const body = [...map.values()].map(r => JSON.stringify(r)).join('\n');
        atomicWriteSync(this.path, body ? body + '\n' : '');
        this.logLines = map.size;
    }

    private load(): Map<string, StoredRecord> {
        if (this.records) return this.records;
        const map = new Map<string, StoredRecord>();
        this.records = map;
        if (!existsSync(this.path)) return map;

        let text: string;
        try { text = readFileSync(this.path, 'utf-8'); } catch { return map; }

        if (text.trimStart().startsWith('[')) {
            // Legacy format: one JSON array. A corrupt file counts as empty, as it always did.
            try {
                for (const r of JSON.parse(text) as StoredRecord[]) map.set(r.id, r);
            } catch { map.clear(); }
            this.compact(); // convert to the log format now
            return map;
        }

        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            this.logLines++;
            let parsed: StoredRecord | DeleteLine;
            try { parsed = JSON.parse(line); } catch { continue; } // torn last line after a crash
            const del = (parsed as Partial<DeleteLine>)._del;
            if (Array.isArray(del)) for (const id of del) map.delete(id);
            else map.set((parsed as StoredRecord).id, parsed as StoredRecord);
        }
        // A last line cut short by a crash has no newline: appending would glue the next line to it.
        if (text.length > 0 && !text.endsWith('\n')) this.compact();
        return map;
    }
}
