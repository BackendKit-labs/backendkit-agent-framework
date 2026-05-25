import type { SessionMemoryData } from '../types';
export declare class SessionMemory implements SessionMemoryData {
    private store;
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): Record<string, string>;
    clear(): void;
}
//# sourceMappingURL=SessionMemory.d.ts.map