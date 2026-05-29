import type { MemoryStoreBackend, StoredRecord } from '../types';

export class InMemoryStore implements MemoryStoreBackend {
    private records: StoredRecord[] = [];

    insert(record: StoredRecord): void {
        this.records.push(record);
    }

    upsert(id: string, record: StoredRecord): void {
        const idx = this.records.findIndex(r => r.id === id);
        if (idx >= 0) this.records[idx] = record;
        else this.records.push(record);
    }

    getAll(): StoredRecord[] { return [...this.records]; }

    deleteOldest(keepNewest: number): void {
        if (this.records.length > keepNewest) {
            this.records = this.records.slice(-keepNewest);
        }
    }

    count(): number { return this.records.length; }
}
