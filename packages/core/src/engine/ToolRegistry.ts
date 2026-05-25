import type { ToolDefinition } from '../types';

/**
 * A registry for managing tool definitions.
 *
 * Provides methods to register, unregister, retrieve, and check for tools
 * by name. Tools are stored in a map keyed by their unique name.
 */
export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();

    /**
     * Register a new tool definition.
     *
     * @param tool - The tool definition to register.
     * @returns The registry instance for method chaining.
     * @throws {Error} If a tool with the same name is already registered.
     */
    register(tool: ToolDefinition): this {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" already registered`);
        }
        this.tools.set(tool.name, tool);
        return this;
    }

    /**
     * Unregister a tool by name.
     *
     * @param name - The name of the tool to remove.
     */
    unregister(name: string): void {
        this.tools.delete(name);
    }

    /**
     * Get a tool definition by name.
     *
     * @param name - The name of the tool to retrieve.
     * @returns The tool definition if found, otherwise `undefined`.
     */
    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all registered tool definitions.
     *
     * @returns An array of all registered tool definitions.
     */
    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool definitions for a specific agent based on an allowlist of tool names.
     *
     * Only tools that are both in the allowlist and currently registered are returned.
     *
     * @param allowedTools - An array of tool names that the agent is allowed to use.
     * @returns An array of matching tool definitions.
     */
    getForAgent(allowedTools: string[]): ToolDefinition[] {
        return allowedTools
            .map(name => this.tools.get(name))
            .filter((t): t is ToolDefinition => t !== undefined);
    }

    /**
     * Check if a tool is registered.
     *
     * @param name - The name of the tool to check.
     * @returns `true` if the tool is registered, otherwise `false`.
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }
}
