"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentEngine = void 0;
const DelegationBus_1 = require("../delegation/DelegationBus");
const SessionMemory_1 = require("../memory/SessionMemory");
const ASK_AGENT_TOOL = {
    name: 'ask_agent',
    description: 'Invokes another AI agent in the system. If you emit 2 or more ask_agent calls ' +
        'in the same response they run IN PARALLEL. Use to split large independent tasks ' +
        'into batches of 2-5 items per agent (max 6 agents per wave).',
    parameters: {
        type: 'object',
        properties: {
            agent_id: { type: 'string', description: 'ID of the agent to invoke' },
            question: { type: 'string', description: 'The task or question for the agent' },
            context: { type: 'string', description: 'Additional context the agent needs' },
        },
        required: ['agent_id', 'question'],
    },
    execute: async () => '',
};
class AgentEngine {
    opts;
    memory = new SessionMemory_1.SessionMemory();
    bus;
    currentAgentId;
    messages = [];
    aborted = false;
    constructor(opts) {
        this.opts = opts;
        this.currentAgentId = opts.defaultAgentId;
        this.bus = new DelegationBus_1.DelegationBus({
            maxParallel: opts.maxParallelAgents ?? 6,
            agents: opts.agents,
            tools: opts.tools,
            provider: opts.provider,
            transport: opts.transport,
            parentMessages: this.messages,
            workingDir: opts.workingDir,
            runAgent: (id, question, context) => this.runAgentInternal(id, question, context),
        });
    }
    async run(input) {
        this.aborted = false;
        this.opts.transport.emit({ type: 'ready' });
        const profile = this.getCurrentProfile();
        if (!profile)
            throw new Error(`Default agent "${this.currentAgentId}" not registered`);
        this.messages.push({ role: 'user', content: input });
        await this.runLoop(profile);
        this.opts.transport.emit({ type: 'done' });
    }
    abort() {
        this.aborted = true;
    }
    switchAgent(agentId) {
        if (!this.opts.agents.has(agentId))
            throw new Error(`Agent "${agentId}" not found`);
        this.currentAgentId = agentId;
    }
    getCurrentProfile() {
        return this.opts.agents.get(this.currentAgentId);
    }
    buildSystemPrompt(profile) {
        return profile.systemPrompt;
    }
    getToolsForAgent(profile) {
        const tools = this.opts.tools.getForAgent(profile.allowedTools);
        // Always inject ask_agent if agent can delegate
        if ((profile.delegatesTo?.length ?? 0) > 0) {
            tools.push(ASK_AGENT_TOOL);
        }
        return tools;
    }
    async runLoop(profile) {
        const maxIter = this.opts.maxIterations ?? 100;
        let iterations = 0;
        this.opts.transport.emit({
            type: 'block_start',
            agent_id: profile.id,
            agent_name: profile.name,
            agent_icon: profile.icon,
        });
        while (iterations < maxIter && !this.aborted) {
            iterations++;
            const systemMsg = { role: 'system', content: this.buildSystemPrompt(profile) };
            const tools = this.getToolsForAgent(profile);
            let streamBuffer = '';
            const askAgentCalls = [];
            const otherCalls = [];
            let finalMessage = null;
            await this.opts.provider.chat([systemMsg, ...this.messages], tools, {
                onChunk: (delta) => {
                    streamBuffer += delta;
                    this.opts.transport.emit({ type: 'token', content: delta });
                },
                onToolCall: (name, args, id) => {
                    this.opts.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 80) });
                    if (name === 'ask_agent') {
                        try {
                            const parsed = JSON.parse(args);
                            askAgentCalls.push({ id, agentId: parsed.agent_id, question: parsed.question, context: parsed.context });
                        }
                        catch {
                            otherCalls.push({ id, name, args });
                        }
                    }
                    else {
                        otherCalls.push({ id, name, args });
                    }
                },
                onDone: (msg) => { finalMessage = msg; },
                onError: (err) => {
                    this.opts.transport.emit({ type: 'error', message: err.message });
                },
            });
            if (!finalMessage)
                break;
            this.messages.push(finalMessage);
            const toolResults = [];
            // ── ask_agent: parallel if 2+ calls ──────────────────────────────
            if (askAgentCalls.length > 0) {
                const requests = askAgentCalls.map(c => ({
                    agentId: c.agentId,
                    question: c.question,
                    context: c.context,
                }));
                const results = askAgentCalls.length >= 2
                    ? await this.bus.runParallel(requests)
                    : [await this.bus.runSingle(requests[0])];
                for (let i = 0; i < askAgentCalls.length; i++) {
                    const call = askAgentCalls[i];
                    const result = results[i];
                    const content = result.error ? `Error: ${result.error}` : result.content;
                    this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: !result.error, preview: content.slice(0, 120) });
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content });
                }
            }
            // ── other tools: sequential ───────────────────────────────────────
            for (const call of otherCalls) {
                const toolDef = this.opts.tools.get(call.name);
                let result;
                if (!toolDef) {
                    result = `Tool "${call.name}" not found`;
                }
                else {
                    const ctx = this.buildContext();
                    try {
                        const args = JSON.parse(call.args);
                        result = await toolDef.execute(args, ctx);
                    }
                    catch (err) {
                        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
                const success = !result.startsWith('Error:');
                this.opts.transport.emit({ type: 'tool_result', name: call.name, success, preview: result.slice(0, 120) });
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
            if (toolResults.length === 0)
                break;
            this.messages.push(...toolResults);
        }
        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
    }
    async runAgentInternal(agentId, question, context) {
        const profile = this.opts.agents.get(agentId);
        if (!profile)
            throw new Error(`Agent "${agentId}" not registered`);
        const start = Date.now();
        const messages = [
            { role: 'system', content: this.buildSystemPrompt(profile) },
            { role: 'user', content: context ? `${question}\n\nContexto:\n${context}` : question },
        ];
        let content = '';
        this.opts.transport.emit({ type: 'block_start', agent_id: profile.id, agent_name: profile.name, agent_icon: profile.icon });
        await this.opts.provider.chat(messages, this.getToolsForAgent(profile), {
            onChunk: (delta) => {
                content += delta;
                this.opts.transport.emit({ type: 'token', content: delta });
            },
            onToolCall: () => { },
            onDone: () => { },
            onError: (err) => { throw err; },
        });
        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
        return { agentId, content, inputTokens: 0, outputTokens: 0, elapsedMs: Date.now() - start };
    }
    buildContext() {
        return {
            agentId: this.currentAgentId,
            sessionId: this.opts.sessionId ?? 'default',
            workingDir: this.opts.workingDir,
            memory: this.memory,
            askAgent: async (agentId, question, context) => {
                const result = await this.bus.runSingle({ agentId, question, context });
                return result.content;
            },
        };
    }
}
exports.AgentEngine = AgentEngine;
//# sourceMappingURL=AgentEngine.js.map