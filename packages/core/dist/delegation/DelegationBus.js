"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DelegationBus = void 0;
class DelegationBus {
    opts;
    maxParallel;
    constructor(opts) {
        this.opts = opts;
        this.maxParallel = opts.maxParallel ?? 6;
    }
    async runParallel(requests) {
        const results = [];
        // Process in waves of maxParallel
        for (let i = 0; i < requests.length; i += this.maxParallel) {
            const wave = requests.slice(i, i + this.maxParallel);
            const waveResults = await Promise.all(wave.map(req => this.runSingle(req)));
            results.push(...waveResults);
        }
        return results;
    }
    async runSingle(request) {
        const profile = this.opts.agents.get(request.agentId);
        if (!profile) {
            return {
                agentId: request.agentId,
                content: `Agent "${request.agentId}" not found in registry`,
                inputTokens: 0,
                outputTokens: 0,
                elapsedMs: 0,
                error: 'agent_not_found',
            };
        }
        this.opts.transport.emit({
            type: 'agent_switch',
            from: 'orchestrator',
            to: profile.id,
            to_name: profile.name,
            to_icon: profile.icon,
        });
        try {
            return await this.opts.runAgent(request.agentId, request.question, request.context);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                agentId: request.agentId,
                content: `Error: ${message}`,
                inputTokens: 0,
                outputTokens: 0,
                elapsedMs: 0,
                error: message,
            };
        }
    }
}
exports.DelegationBus = DelegationBus;
//# sourceMappingURL=DelegationBus.js.map