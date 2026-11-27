import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteSync } from '../../shared/utils/atomic-write';
import { withFileLockSync } from '../../shared/utils/file-lock';
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

    upsertMany(records: StoredRecord[]): void {
        if (records.length === 0) return;
        const map = this.load();
        for (const record of records) map.set(record.id, record);
        this.append(records.map(r => JSON.stringify(r)).join('\n'), records.length);
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

    // Writes hold the file's lock (in the process and across processes, see file-lock), so that a compaction here never
    // rewrites the file over a line another process appended meanwhile (audit D-01).
    private append(lines: string, count = 1): void {
        withFileLockSync(this.path, () => {
            appendFileSync(this.path, lines + '\n');
            this.logLines += count;
            const live = this.load().size;
            if (this.logLines > Math.max(COMPACT_MIN, live * COMPACT_RATIO)) this.compactLocked();
        });
    }

    /**
     * Rewrites the log with the live records. Called holding the lock. It replays the file as it is on disk now, not this
     * process's copy, so records other processes appended since this one loaded are kept (and seen from now on).
     */
    private compactLocked(): void {
        // Every write of this process is already a line on disk, so the file is the whole truth: what is only in this
        // process's copy was removed by another process, and must not come back.
        const { map } = this.readDisk();
        const body = [...map.values()].map(r => JSON.stringify(r)).join('\n');
        atomicWriteSync(this.path, body ? body + '\n' : '');
        this.records = map;
        this.logLines = map.size;
    }

    /** The records the file holds now, and whether it needs rewriting (legacy array format, or a last line torn by a crash). */
    private readDisk(): { map: Map<string, StoredRecord>; lines: number; rewrite: boolean } {
        const map = new Map<string, StoredRecord>();
        if (!existsSync(this.path)) return { map, lines: 0, rewrite: false };
        let text: string;
        try { text = readFileSync(this.path, 'utf-8'); } catch { return { map, lines: 0, rewrite: false }; }

        if (text.trimStart().startsWith('[')) {
            // Legacy format: one JSON array. A corrupt file counts as empty, as it always did.
            try {
                for (const r of JSON.parse(text) as StoredRecord[]) map.set(r.id, r);
            } catch { map.clear(); }
            return { map, lines: map.size, rewrite: true }; // convert to the log format now
        }

        let lines = 0;
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            lines++;
            let parsed: StoredRecord | DeleteLine;
            try { parsed = JSON.parse(line); } catch { continue; } // torn last line after a crash
            const del = (parsed as Partial<DeleteLine>)._del;
            if (Array.isArray(del)) for (const id of del) map.delete(id);
            else map.set((parsed as StoredRecord).id, parsed as StoredRecord);
        }
        // A last line cut short by a crash has no newline: appending would glue the next line to it.
        return { map, lines, rewrite: text.length > 0 && !text.endsWith('\n') };
    }

    private load(): Map<string, StoredRecord> {
        if (this.records) return this.records;
        const { map, lines, rewrite } = this.readDisk();
        this.records = map;
        this.logLines = lines;
        if (rewrite) withFileLockSync(this.path, () => this.compactLocked());
        return this.records;
    }
}
