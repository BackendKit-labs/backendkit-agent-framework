import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteSync } from '../../shared/utils/atomic-write';
import type { MemoryStoreBackend, StoredRecord } from '../types';

/**
 * Persistent JSON file backend.
 * Reads are lazy-cached; writes use atomicWriteSync (tmp + rename) to avoid corruption.
 */
export class JsonFileStore implements MemoryStoreBackend {
    private cache: StoredRecord[] | null = null;

    constructor(private readonly path: string) {
        mkdirSync(dirname(path), { recursive: true });
    }

    insert(record: StoredRecord): void {
        const records = this.load();
        records.push(record);
        this.persist(records);
    }

    upsert(id: string, record: StoredRecord): void {
        const records = this.load();
        const idx = records.findIndex(r => r.id === id);
        if (idx >= 0) records[idx] = record;
        else records.push(record);
        this.persist(records);
    }

    getAll(): StoredRecord[] { return this.load(); }

    deleteOldest(keepNewest: number): void {
        const records = this.load();
        if (records.length > keepNewest) {
            this.persist(records.slice(-keepNewest));
        }
    }

    deleteByIds(ids: string[]): void {
        const set = new Set(ids);
        this.persist(this.load().filter(r => !set.has(r.id)));
    }

    count(): number { return this.load().length; }

    private load(): StoredRecord[] {
        if (this.cache) return this.cache;
        if (!existsSync(this.path)) { this.cache = []; return []; }
        try {
            this.cache = JSON.parse(readFileSync(this.path, 'utf-8')) as StoredRecord[];
        } catch {
            this.cache = [];
        }
        return this.cache;
    }

    private persist(records: StoredRecord[]): void {
        this.cache = records;
        atomicWriteSync(this.path, JSON.stringify(records, null, 2));
    }
}
