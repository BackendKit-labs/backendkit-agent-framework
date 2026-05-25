"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
class ToolRegistry {
    tools = new Map();
    register(tool) {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" already registered`);
        }
        this.tools.set(tool.name, tool);
        return this;
    }
    unregister(name) {
        this.tools.delete(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    getAll() {
        return Array.from(this.tools.values());
    }
    getForAgent(allowedTools) {
        return allowedTools
            .map(name => this.tools.get(name))
            .filter((t) => t !== undefined);
    }
    has(name) {
        return this.tools.has(name);
    }
}
exports.ToolRegistry = ToolRegistry;
//# sourceMappingURL=ToolRegistry.js.map