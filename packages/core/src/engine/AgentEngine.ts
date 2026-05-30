import { appendFile, mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
    AgentProfile,
    EngineOptions,
    ExecutionContext,
    LLMMessage,
    LLMProvider,
    SessionMemoryData,
    ToolDefinition,
    Skill,
} from '../types';
import type { Transport } from '../transport/Transport';
import type { AgentRegistry } from './AgentRegistry';
import type { ToolRegistry } from './ToolRegistry';
import { ProviderRegistry } from './ProviderRegistry';
import { DelegationBus } from '../delegation/DelegationBus';
import { SessionMemory } from '../memory/SessionMemory';
import { SkillActivator } from '../skills/activator';
import { MCPClientManager } from '../mcp/MCPClientManager';
import type { ObservabilityManager } from '../observability/ObservabilityManager';
import type { MemorySystem } from '../agent-memory/MemorySystem';
import { WorkflowRunner } from '../workflow/WorkflowRunner';
import type { WorkflowDef, WorkflowResult, WorkflowRunOptions } from '../workflow/types';
import type { WorkflowBuilder } from '../workflow/WorkflowBuilder';
import type { Orchestrator } from '../orchestration/orchestrator';
import type { OrchestrationResult } from '../orchestration/types';
import type { QAService } from '../qa/qa-service';
import {
    advanceRequiredGates,
    activateQaEngineerIfNeeded,
    processQaEngineerResponse,
    processInlineQaReview,
} from './qa-orchestrator';

export interface AgentEngineOptions extends EngineOptions {
    agents: AgentRegistry;
    tools: ToolRegistry;
    /** Registry of all available providers */
    providers: ProviderRegistry;
    /** ID of the provider to use when an agent has no explicit provider set */
    defaultProvider: string;
    transport: Transport;
    defaultAgentId: string;
    /** Optional persistent memory — replaces the default in-memory SessionMemory */
    sessionMemory?: SessionMemoryData;
    /** Orchestrator para clasificacion de tareas, risk scoring y FSM */
    orchestrator?: Orchestrator;
    /** QA service para revisar respuestas y registrar gates */
    qaService?: QAService;
    /** Si true, deshabilita las revisiones de QA automaticas */
    noQA?: boolean;
    /** Callback invocado cuando el QA genera una revision */
    onQAReview?: (review: string) => void;
    /** MCP client manager — connects to external MCP servers and registers their tools */
    mcpManager?: MCPClientManager;
    /** Observability manager — pre-created and transport-wrapped by createBaseEngine */
    observabilityManager?: ObservabilityManager;
    /** Advanced memory system — episodic/semantic/procedural */
    memorySystem?: MemorySystem;
    /** Called once on the first run/runWorkflow to load discovered agents from disk or remote. */
    loadAgents?: () => Promise<import('../types').AgentProfile[]>;
    /**
     * Path to an append-only NDJSON file for tool call audit records.
     * Each executed tool call is appended as one JSON line with: ts, session, agent, tool, inputPreview, success, durationMs.
     * Directory is created automatically. Optional — no audit file written when absent.
     */
    auditLog?: string;
}

const MAX_INPUT_BYTES = 100_000; // Fix #17: 100 KB hard cap on user input

const ASK_AGENT_TOOL: ToolDefinition = {
    name: 'ask_agent',
    description:
        'Invokes another AI agent in the system. If you emit 2 or more ask_agent calls ' +
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

export class AgentEngine {
    private readonly memory: SessionMemoryData;
    private readonly bus: DelegationBus;
    private readonly skillActivator = new SkillActivator();
    private currentAgentId: string;
    private messages: LLMMessage[] = [];
    private aborted = false;
    private allSkills: Skill[];
    private activeSkillAddition = '';
    private yamlSkillsLoaded = false;
    private mcpInitialized = false;
    private agentsLoaded = false;
    private memoryContextBlock = '';

    constructor(private readonly opts: AgentEngineOptions) {
        this.memory = opts.sessionMemory ?? new SessionMemory();
        this.currentAgentId = opts.defaultAgentId;
        this.allSkills = opts.skills ?? [];
        if (opts.auditLog) {
            try { mkdirSync(dirname(opts.auditLog), { recursive: true }); } catch {}
        }
        this.bus = new DelegationBus({
            maxParallel: opts.maxParallelAgents ?? 6,
            agents: opts.agents,
            tools: opts.tools,
            transport: opts.transport,
            parentMessages: this.messages,
            workingDir: opts.workingDir,
            runAgent: (id, question, context) => this.runAgentInternal(id, question, context),
        });
    }

    /** Access the observability manager when configured via createBaseEngine({ observability }). */
    get observability(): ObservabilityManager | undefined {
        return this.opts.observabilityManager;
    }

    /** Access the MCP client manager to inspect connected servers and their tools. */
    getMCPManager(): MCPClientManager | undefined {
        return this.opts.mcpManager;
    }

    private getProviderForProfile(profile: AgentProfile): LLMProvider {
        return this.opts.providers.resolve(profile.provider, this.opts.defaultProvider);
    }

    async run(input: string): Promise<void> {
        this.aborted = false;
        this.opts.transport.emit({ type: 'ready' });

        // Fix #17: reject inputs that exceed the hard cap to prevent prompt injection via huge payloads
        if (Buffer.byteLength(input, 'utf-8') > MAX_INPUT_BYTES) {
            this.opts.transport.emit({
                type: 'error',
                message: `Input too large (${Buffer.byteLength(input, 'utf-8').toLocaleString()} bytes). Maximum is ${MAX_INPUT_BYTES.toLocaleString()} bytes.`,
            });
            this.opts.transport.emit({ type: 'done' });
            return;
        }

        await this.ensureMCPInitialized();
        await this.ensureAgentsLoaded();

        // Pre-compute memory context block for this input
        if (this.opts.memorySystem) {
            this.memoryContextBlock = await this.opts.memorySystem.buildContextBlock(input).catch(() => '');
        }

        // Lazy-load user YAML skills (global + packs + project) on first call
        if (!this.yamlSkillsLoaded && this.opts.loadSkills) {
            try {
                const yamlSkills = await this.opts.loadSkills();
                this.allSkills = [...this.allSkills, ...yamlSkills];
            } catch { /* non-fatal: skip if filesystem skills unavailable */ }
            this.yamlSkillsLoaded = true;
        }

        // Activate skills relevant to this specific input
        if (this.allSkills.length > 0) {
            const active = this.skillActivator.activate(
                input,
                this.allSkills,
                this.opts.detectedStack ?? [],
            );
            this.activeSkillAddition = this.skillActivator.buildSystemPromptAddition(active);
        }

        const profile = this.getCurrentProfile();
        if (!profile) throw new Error(`Default agent "${this.currentAgentId}" not registered`);

        // Orquestar la tarea para obtener clasificacion, risk scoring y gates requeridos
        let orchestrationResult: OrchestrationResult | undefined;
        if (this.opts.orchestrator) {
            orchestrationResult = await this.opts.orchestrator.orchestrate(input).catch(() => undefined);
        }

        this.messages.push({ role: 'user', content: input });
        await this.runLoop(profile, orchestrationResult);
        this.opts.transport.emit({ type: 'done' });
    }

    async runWorkflow(
        defOrBuilder: WorkflowDef | WorkflowBuilder,
        opts: WorkflowRunOptions = {},
    ): Promise<WorkflowResult> {
        await this.ensureMCPInitialized();
        await this.ensureAgentsLoaded();
        const def = 'build' in defOrBuilder ? defOrBuilder.build() : defOrBuilder;
        const runner = new WorkflowRunner(def, {
            ...opts,
            runAgent: (agentId, input, context) => this.runAgentInternal(agentId, input, context),
            transport: this.opts.transport,
        });
        return runner.run();
    }

    abort(): void {
        this.aborted = true;
    }

    /**
     * Trim conversation history to maxContextMessages by dropping oldest messages
     * at a user-turn boundary. Preserves all assistant↔tool pairs intact.
     */
    private trimHistory(): void {
        const max = this.opts.maxContextMessages;
        if (!max || this.messages.length <= max) return;

        // Walk forward from the target offset to find the next 'user' message.
        // Cutting there avoids orphaning assistant tool_calls / tool results.
        const target = this.messages.length - max;
        let cutAt = target;
        while (cutAt < this.messages.length && this.messages[cutAt].role !== 'user') {
            cutAt++;
        }

        if (cutAt > 0 && cutAt < this.messages.length) {
            this.messages = this.messages.slice(cutAt);
            this.opts.transport.emit({
                type: 'system',
                level: 'warn',
                text: `[ContextWindow] Dropped ${cutAt} messages — history capped at ${max} (maxContextMessages)`,
            });
        }
    }

    private async ensureAgentsLoaded(): Promise<void> {
        if (this.agentsLoaded || !this.opts.loadAgents) return;
        this.agentsLoaded = true; // set early to prevent concurrent double-loads
        try {
            const discovered = await this.opts.loadAgents();
            for (const agent of discovered) this.opts.agents.upsert(agent);
            // If the current default agent still isn't registered, fall back to first available
            if (!this.opts.agents.has(this.currentAgentId)) {
                const all = this.opts.agents.getAll();
                if (all.length > 0) this.currentAgentId = all[0].id;
            }
        } catch (err) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `[AgentDiscovery] Failed to load agents: ${(err as Error).message}`,
            });
        }
    }

    private async ensureMCPInitialized(): Promise<void> {
        if (this.mcpInitialized || !this.opts.mcpManager) return;
        try {
            await this.opts.mcpManager.initialize();
            for (const tool of this.opts.mcpManager.getTools()) {
                this.opts.tools.register(tool);
            }
        } catch (err) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `MCP initialization error: ${(err as Error).message}`,
            });
        }
        this.mcpInitialized = true;
    }

    switchAgent(agentId: string): void {
        if (!this.opts.agents.has(agentId)) throw new Error(`Agent "${agentId}" not found`);
        this.currentAgentId = agentId;
    }

    private getCurrentProfile(): AgentProfile | undefined {
        return this.opts.agents.get(this.currentAgentId);
    }

    private buildAgentRoster(excludeId: string): string {
        const entries = this.opts.agents.getAll()
            .filter(a => a.id !== excludeId)
            .map(a => {
                const tag = a.source === 'project' ? ' [PROJECT]' : a.source === 'global' ? ' [GLOBAL]' : '';
                return `- ${a.id} (${a.icon}): ${a.description}${tag}`;
            })
            .join('\n');
        return `## Available Agents\nUse ask_agent to delegate tasks:\n${entries}`;
    }

    private buildSystemPrompt(profile: AgentProfile): string {
        const isOrchestrator = profile.id === this.opts.defaultAgentId;
        const parts: string[] = [profile.systemPrompt];
        if (isOrchestrator) parts.push(this.buildAgentRoster(profile.id));
        if (this.opts.projectContext) parts.push(this.opts.projectContext);
        if (this.memoryContextBlock) parts.push(this.memoryContextBlock);
        if (this.activeSkillAddition) parts.push(this.activeSkillAddition);
        return parts.join('\n\n');
    }

    private resolvesDelegateTo(profile: AgentProfile): string[] {
        if (!profile.delegatesTo || profile.delegatesTo.length === 0) return [];
        if (profile.delegatesTo[0] === '*') {
            return this.opts.agents.getAll()
                .map(a => a.id)
                .filter(id => id !== profile.id);
        }
        return profile.delegatesTo as string[];
    }

    private getToolsForAgent(profile: AgentProfile): ToolDefinition[] {
        const tools = this.opts.tools.getForAgent(profile.allowedTools);
        if (this.resolvesDelegateTo(profile).length > 0) {
            tools.push(ASK_AGENT_TOOL);
        }
        return tools;
    }

    private async runLoop(profile: AgentProfile, orchestrationResult?: OrchestrationResult): Promise<void> {
        const maxIter = this.opts.maxIterations ?? 100;
        let iterations = 0;
        let currentProfile = profile;

        this.opts.transport.emit({
            type: 'block_start',
            agent_id: profile.id,
            agent_name: profile.name,
            agent_icon: profile.icon,
        });

        while (iterations < maxIter && !this.aborted) {
            iterations++;
            this.trimHistory();

            const systemMsg: LLMMessage = { role: 'system', content: this.buildSystemPrompt(currentProfile) };
            const tools = this.getToolsForAgent(currentProfile);

            let streamBuffer = '';
            const askAgentCalls: Array<{ id: string; agentId: string; question: string; context?: string }> = [];
            const otherCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;

            await this.getProviderForProfile(currentProfile).chat(
                [systemMsg, ...this.messages],
                tools,
                {
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
                            } catch {
                                otherCalls.push({ id, name, args });
                            }
                        } else {
                            otherCalls.push({ id, name, args });
                        }
                    },
                    onDone: (msg) => { finalMessage = msg; },
                    onError: (err) => {
                        this.opts.transport.emit({ type: 'error', message: err.message });
                    },
                    onMetrics: (inputTokens, outputTokens) => {
                        this.opts.transport.emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens });
                    },
                }
            );

            if (!finalMessage) break;

            this.messages.push(finalMessage);

            const toolResults: LLMMessage[] = [];

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
                let result: string;
                const callStart = Date.now();
                if (!toolDef) {
                    result = `Tool "${call.name}" not found`;
                } else {
                    const ctx = this.buildContext();
                    try {
                        const args = JSON.parse(call.args);
                        result = await toolDef.execute(args, ctx);
                    } catch (err) {
                        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
                const success = !result.startsWith('Error:');
                this.writeAuditRecord(currentProfile.id, call.name, call.args, success, Date.now() - callStart);
                this.opts.transport.emit({ type: 'tool_result', name: call.name, success, preview: result.slice(0, 120) });
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }

            // ── QA orchestration: runs when response is final (no tool calls) ─
            if (toolResults.length === 0 && this.opts.orchestrator && this.opts.qaService && orchestrationResult) {
                const qaCtx = {
                    clean: streamBuffer,
                    orchestrationResult,
                    orchestrator: this.opts.orchestrator,
                    qaService: this.opts.qaService,
                    allAgents: this.opts.agents.getAll(),
                    messages: this.messages,
                    effectiveAgentId: currentProfile.id,
                    noQA: this.opts.noQA,
                    onQAReview: this.opts.onQAReview,
                    setEffectiveAgent: (agentId: string) => {
                        const p = this.opts.agents.get(agentId);
                        if (p) currentProfile = p;
                    },
                };

                await advanceRequiredGates(qaCtx);

                const qaProfile = activateQaEngineerIfNeeded(qaCtx);
                if (qaProfile) {
                    currentProfile = qaProfile;
                    continue; // re-enter loop as qa-engineer
                }

                if (currentProfile.id === 'qa-engineer') {
                    await processQaEngineerResponse(qaCtx);
                    currentProfile = profile; // reset to original agent
                } else {
                    await processInlineQaReview(qaCtx);
                }
            }

            if (toolResults.length === 0) break;
            this.messages.push(...toolResults);
        }

        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
    }

    private async runAgentInternal(agentId: string, question: string, context?: string): Promise<{ agentId: string; content: string; inputTokens: number; outputTokens: number; elapsedMs: number }> {
        const profile = this.opts.agents.get(agentId);
        if (!profile) throw new Error(`Agent "${agentId}" not registered`);

        const start = Date.now();
        const messages: LLMMessage[] = [
            { role: 'system', content: this.buildSystemPrompt(profile) },
            { role: 'user', content: context ? `${question}\n\nContexto:\n${context}` : question },
        ];

        let finalContent = '';
        const maxIter = 30;
        let iter = 0;

        this.opts.transport.emit({ type: 'block_start', agent_id: profile.id, agent_name: profile.name, agent_icon: profile.icon });

        while (iter < maxIter) {
            iter++;

            let streamContent = '';
            const toolCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;

            await this.getProviderForProfile(profile).chat(messages, this.getToolsForAgent(profile), {
                onChunk: (delta) => {
                    streamContent += delta;
                    this.opts.transport.emit({ type: 'token', content: delta });
                },
                onToolCall: (name, args, id) => {
                    this.opts.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 80) });
                    toolCalls.push({ id, name, args });
                },
                onDone: (msg) => { finalMessage = msg; },
                onError: (err) => { throw err; },
                onMetrics: (inputTokens, outputTokens) => {
                    this.opts.transport.emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens });
                },
            });

            if (!finalMessage) break;
            if (streamContent) finalContent = streamContent;
            messages.push(finalMessage);

            if (toolCalls.length === 0) break;

            const toolResults: LLMMessage[] = [];
            for (const call of toolCalls) {
                const toolDef = this.opts.tools.get(call.name);
                let result: string;
                const callStart = Date.now();
                if (!toolDef) {
                    result = `Tool "${call.name}" not found`;
                } else {
                    const ctx = this.buildContext();
                    try {
                        const args = JSON.parse(call.args);
                        result = await toolDef.execute(args, ctx);
                    } catch (err) {
                        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
                const success = !result.startsWith('Error:');
                this.writeAuditRecord(profile.id, call.name, call.args, success, Date.now() - callStart);
                this.opts.transport.emit({ type: 'tool_result', name: call.name, success, preview: result.slice(0, 120) });
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
            messages.push(...toolResults);
        }

        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });

        return { agentId, content: finalContent, inputTokens: 0, outputTokens: 0, elapsedMs: Date.now() - start };
    }

    // Fix #15: fire-and-forget NDJSON audit record after each tool execution
    private writeAuditRecord(agentId: string, tool: string, inputPreview: string, success: boolean, durationMs: number): void {
        if (!this.opts.auditLog) return;
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            session: this.opts.sessionId ?? 'default',
            agent: agentId,
            tool,
            input: inputPreview.slice(0, 200),
            success,
            durationMs,
        });
        appendFile(this.opts.auditLog, line + '\n', () => {});
    }

    private buildContext(): ExecutionContext {
        return {
            agentId: this.currentAgentId,
            sessionId: this.opts.sessionId ?? 'default',
            workingDir: this.opts.workingDir,
            memory: this.memory,
            store: this.opts.store,
            advancedMemory: this.opts.memorySystem,
            askAgent: async (agentId, question, context) => {
                const result = await this.bus.runSingle({ agentId, question, context });
                return result.content;
            },
        };
    }
}
