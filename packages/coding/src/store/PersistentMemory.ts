import { readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@bk/agent-core';
import type { SessionMemoryData } from '@bk/agent-core';

export class PersistentMemory implements SessionMemoryData {
    private data: Record<string, string> = {};
    private readonly filePath: string;

    constructor(projectDir: string) {
        this.filePath = join(projectDir, 'memory.json');
        try {
            this.data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        } catch { /* first run — start empty */ }
    }

    get(key: string): string | undefined {
        return this.data[key];
    }

    set(key: string, value: string): void {
        this.data[key] = value;
        atomicWriteSync(this.filePath, JSON.stringify(this.data, null, 2));
    }

    getAll(): Record<string, string> {
        return { ...this.data };
    }
}
