import type { ToolDefinition } from '../types';

export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();

    register(tool: ToolDefinition): this {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" already registered`);
        }
        this.tools.set(tool.name, tool);
        return this;
    }

    unregister(name: string): void {
        this.tools.delete(name);
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    getForAgent(allowedTools: string[]): ToolDefinition[] {
        return allowedTools
            .map(name => this.tools.get(name))
            .filter((t): t is ToolDefinition => t !== undefined);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }
}
