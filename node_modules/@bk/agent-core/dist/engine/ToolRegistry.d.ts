import type { ToolDefinition } from '../types';
export declare class ToolRegistry {
    private tools;
    register(tool: ToolDefinition): this;
    unregister(name: string): void;
    get(name: string): ToolDefinition | undefined;
    getAll(): ToolDefinition[];
    getForAgent(allowedTools: string[]): ToolDefinition[];
    has(name: string): boolean;
}
//# sourceMappingURL=ToolRegistry.d.ts.map