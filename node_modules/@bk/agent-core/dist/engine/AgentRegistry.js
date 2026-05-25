"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRegistry = void 0;
class AgentRegistry {
    agents = new Map();
    register(profile) {
        if (this.agents.has(profile.id)) {
            throw new Error(`Agent "${profile.id}" already registered`);
        }
        this.agents.set(profile.id, profile);
        return this;
    }
    registerAll(profiles) {
        for (const p of profiles)
            this.register(p);
        return this;
    }
    get(id) {
        return this.agents.get(id);
    }
    getAll() {
        return Array.from(this.agents.values());
    }
    has(id) {
        return this.agents.has(id);
    }
}
exports.AgentRegistry = AgentRegistry;
//# sourceMappingURL=AgentRegistry.js.map