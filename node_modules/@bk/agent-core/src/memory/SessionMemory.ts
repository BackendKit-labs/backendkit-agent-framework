import type { SessionMemoryData } from '../types';

export class SessionMemory implements SessionMemoryData {
    private store = new Map<string, string>();

    get(key: string): string | undefined {
        return this.store.get(key);
    }

    set(key: string, value: string): void {
        this.store.set(key, value);
    }

    getAll(): Record<string, string> {
        return Object.fromEntries(this.store.entries());
    }

    clear(): void {
        this.store.clear();
    }
}
