import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteSync } from '../shared/utils/atomic-write';
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
    /**
     * Called before executing write/execute tools (write_file, edit_file, run_command) when
     * iteration mode is 'manual'. Return 'approve' to run, 'approve_all' to run and disable
     * further prompts this session, 'reject' to skip the tool call.
     */
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<import('../types').ToolApprovalDecision>;
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
        'Invokes another AI agent in the system. Multiple ask_agent calls in the same response ' +
        'run concurrently (up to 6 at a time via a bulkhead). Use to split large independent ' +
        'tasks across 2-5 specialist agents per response.',
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
    private mcpInitAttempts = 0;
    private mcpRegisteredServers = new Set<string>();
    private mcpTriggers = new Map<string, string[]>();                        // agentId → triggers
    private mcpToolTriggers = new Map<string, { agentId: string; tool: string }>(); // keyword → {agentId, tool}
    private approvalDisabled = false; // set to true after 'approve_all'

    private static readonly WRITE_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);
    private agentsLoaded = false;
    private memoryContextBlock = '';

    constructor(private readonly opts: AgentEngineOptions) {
        this.memory = opts.sessionMemory ?? new SessionMemory();
        this.currentAgentId = opts.defaultAgentId;
        this.allSkills = opts.skills ?? [];
        if (opts.auditLog) {
            try { mkdirSync(dirname(opts.auditLog), { recursive: true }); } catch {}
        }
        if (opts.historyPath && existsSync(opts.historyPath)) {
            try {
                const raw = JSON.parse(readFileSync(opts.historyPath, 'utf-8')) as LLMMessage[];
                this.messages = raw.filter(m => m.role !== 'system');
            } catch { /* corrupt or missing — start fresh */ }
        }
        this.bus = new DelegationBus({
            maxParallel: opts.maxParallelAgents ?? 6,
            agents: opts.agents,
            tools: opts.tools,
            transport: opts.transport,
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

        // Direct MCP routing: bypass general when input matches a configured trigger
        const mcpRoute = this.findMCPRoute(input);
        if (mcpRoute) {
            if (mcpRoute.tool) {
                // Tool trigger: call the MCP tool directly — no intermediate LLM
                const toolName = `mcp__${mcpRoute.agentId}__${mcpRoute.tool}`;
                const toolDef = this.opts.tools.get(toolName);
                if (toolDef) {
                    const required = (toolDef.parameters as { required?: string[] }).required;
                    const firstParam = required?.[0] ?? 'input';
                    const ctx = this.buildContext();
                    const profile = this.opts.agents.get(mcpRoute.agentId);
                    this.opts.transport.emit({
                        type: 'block_start',
                        agent_id: mcpRoute.agentId,
                        agent_name: profile?.name ?? mcpRoute.agentId,
                        agent_icon: profile?.icon ?? '◎',
                    });
                    const result = await toolDef.execute({ [firstParam]: input }, ctx);
                    this.opts.transport.emit({ type: 'token', content: result, agent_id: mcpRoute.agentId });
                    this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: mcpRoute.agentId });
                    this.opts.transport.emit({ type: 'done' });
                    return;
                }
            }
            // Agent trigger fallback: route to the agent's LLM session
            await this.runAgentInternal(mcpRoute.agentId, input);
            this.opts.transport.emit({ type: 'done' });
            return;
        }

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
        this.saveHistory();
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

    /** Delete persisted history file and reset in-memory conversation. */
    clearHistory(): void {
        this.messages = [];
        if (!this.opts.historyPath) return;
        try { atomicWriteSync(this.opts.historyPath, '[]'); } catch { /* non-fatal */ }
    }

    /** Serialize current conversation to disk (called automatically after each run). */
    private saveHistory(): void {
        if (!this.opts.historyPath) return;
        const cap = this.opts.maxContextMessages ?? 100;
        const toSave = this.messages.filter(m => m.role !== 'system').slice(-cap);
        try {
            mkdirSync(dirname(this.opts.historyPath), { recursive: true });
            atomicWriteSync(this.opts.historyPath, JSON.stringify(toSave, null, 2));
        } catch { /* non-fatal — history loss is preferable to a crash */ }
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
        if (!this.opts.mcpManager) return;

        try {
            if (!this.mcpInitialized) {
                await this.opts.mcpManager.initialize();
                this.mcpInitialized = true;
            } else {
                // Subsequent runs: retry only servers that are still offline — bounded by their own counter
                const offline = this.opts.mcpManager.getConfiguredNames()
                    .filter(n => !this.mcpRegisteredServers.has(n));
                if (offline.length > 0 && this.mcpInitAttempts < 3) {
                    this.mcpInitAttempts++;
                    await this.opts.mcpManager.reconnectFailed();
                }
            }
        } catch (err) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `MCP initialization error: ${(err as Error).message}`,
            });
        }

        // Always register any server that is now connected but not yet registered as agent.
        // This runs regardless of the retry counter so late-starting servers get picked up.
        for (const { name, toolCount } of this.opts.mcpManager.getServerInfo()) {
            if (toolCount > 0 && !this.mcpRegisteredServers.has(name)) {
                const tools  = this.opts.mcpManager.getServerTools(name);
                const config = this.opts.mcpManager.getConfig(name)!;
                this.registerMCPAgent(config, tools);
                this.mcpRegisteredServers.add(name);
            }
        }

        // Warn about servers still offline (only while retries remain)
        const stillOffline = this.opts.mcpManager.getConfiguredNames()
            .filter(n => !this.mcpRegisteredServers.has(n));
        if (stillOffline.length > 0) {
            const retriesLeft = 3 - this.mcpInitAttempts;
            const suffix = retriesLeft > 0
                ? `Retrying on next message (${retriesLeft} attempts left).`
                : `No more automatic retries — call engine.getMCPManager()?.reconnectFailed() to retry manually.`;
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `MCP agents offline: ${stillOffline.join(', ')} — start their servers to enable them. ${suffix}`,
            });
        }
    }

    private registerMCPAgent(
        config: import('../mcp/types').MCPServerConfig,
        tools: import('../types').ToolDefinition[],
    ): void {
        // safeName mirrors the sanitization done by MCPClientManager.wrapTool() so that
        // tool lookup `mcp__${agentId}__${tool}` always resolves correctly.
        const safeName = config.name.replace(/[^a-zA-Z0-9_-]/g, '_');

        // Register tools in the global ToolRegistry so they can execute
        for (const tool of tools) {
            this.opts.tools.register(tool);
        }

        const toolList = tools
            .map(t => {
                // name format: mcp__{safeName}__{tool}
                const shortName = t.name.split('__')[2] ?? t.name;
                const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '').slice(0, 80);
                return `- ${shortName}: ${desc}`;
            })
            .join('\n');

        const enrichedDesc = tools
            .map(t => {
                const shortName = t.name.split('__')[2] ?? t.name;
                const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '').slice(0, 70);
                return `${shortName}: ${desc}`;
            })
            .join(' | ');

        // Use safeName as agent id so tool lookup `mcp__${agentId}__${tool}` always resolves.
        this.opts.agents.upsert({
            id:           safeName,
            name:         config.agentName ?? toTitleCase(config.name),
            icon:         config.icon ?? '◎',
            description:  config.agentDescription ?? `External specialist — ${enrichedDesc}`,
            systemPrompt:
                `You are a specialized remote agent: ${config.name}.\n` +
                `Use ONLY your available tools to answer the request. ` +
                `Do NOT use run_command, read_file, or other local tools.\n\n` +
                `Your tools:\n${toolList}`,
            allowedTools: tools.map(t => t.name),
            source:       'mcp',
        });

        if (config.triggers?.length) {
            this.mcpTriggers.set(safeName, config.triggers);
        }

        if (config.toolTriggers) {
            for (const [keyword, tool] of Object.entries(config.toolTriggers)) {
                this.mcpToolTriggers.set(keyword.toLowerCase(), { agentId: safeName, tool });
            }
        }
    }

    private findMCPRoute(input: string): { agentId: string; tool?: string } | undefined {
        const lower = input.toLowerCase();
        for (const [keyword, route] of this.mcpToolTriggers) {
            if (lower.includes(keyword)) return route;
        }
        for (const [agentId, triggers] of this.mcpTriggers) {
            if (triggers.some(t => lower.includes(t.toLowerCase()))) return { agentId };
        }
        return undefined;
    }

    switchAgent(agentId: string): void {
        if (!this.opts.agents.has(agentId)) throw new Error(`Agent "${agentId}" not found`);
        this.currentAgentId = agentId;
    }

    private getCurrentProfile(): AgentProfile | undefined {
        return this.opts.agents.get(this.currentAgentId);
    }

    private buildAgentRoster(excludeId: string): string {
        const all = this.opts.agents.getAll().filter(a => a.id !== excludeId);
        const mcp   = all.filter(a => a.source === 'mcp');
        const local = all.filter(a => a.source !== 'mcp');

        const parts: string[] = [];

        if (mcp.length > 0) {
            parts.push('## External Agents [MCP] — CHECK FIRST. If the task matches any of these, you MUST delegate to them via ask_agent before considering local agents.');
            for (const a of mcp) {
                parts.push(`- ${a.id} (${a.icon}): ${a.description} [MCP]`);
            }
        }

        parts.push('## Local Agents — use only when no [MCP] agent covers the task.');
        for (const a of local) {
            const tag = a.source === 'project' ? ' [PROJECT]' : a.source === 'global' ? ' [GLOBAL]' : '';
            parts.push(`- ${a.id} (${a.icon}): ${a.description}${tag}`);
        }

        return parts.join('\n');
    }

    private buildSystemPrompt(profile: AgentProfile, orchestrationResult?: OrchestrationResult): string {
        const isOrchestrator = profile.id === this.opts.defaultAgentId;
        const parts: string[] = [profile.systemPrompt];
        if (isOrchestrator) parts.push(this.buildAgentRoster(profile.id));
        if (this.opts.workingDir) {
            parts.push(
                `## Working Directory\n` +
                `\`${this.opts.workingDir}\`\n\n` +
                `ALWAYS use RELATIVE paths with tools (e.g. \`src/index.ts\`, \`package.json\`). ` +
                `NEVER invent absolute paths like \`/workspace/...\` or \`/home/...\`.`
            );
        }
        if (this.opts.projectContext) parts.push(this.opts.projectContext);
        if (this.memoryContextBlock) parts.push(this.memoryContextBlock);
        if (this.activeSkillAddition) parts.push(this.activeSkillAddition);
        if (isOrchestrator && orchestrationResult) {
            parts.push(this.buildOrchestrationBrief(orchestrationResult));
        }
        return parts.join('\n\n');
    }

    /**
     * Converts an OrchestrationResult into a system-prompt section that tells the
     * default agent which specialists to use, in what order, and what gates apply.
     * This closes the gap between the deterministic policy layer and the LLM layer.
     */
    private buildOrchestrationBrief(result: OrchestrationResult): string {
        const { task, selectedAgents, agentPipeline, requiredGates } = result;

        const lines: string[] = ['## Orchestrator Analysis — Current Task'];

        const domains = task.domains.length > 0 ? task.domains.join(', ') : 'general';
        lines.push(`**Intent:** ${task.actionType} | **Risk:** ${task.riskLevel} | **Domains:** ${domains}`);

        // Only surface non-trivial agent selections (skip sole-fallback case)
        const nonFallback = selectedAgents.filter(a => !(a.agentId === 'general' && a.score <= 50));
        if (nonFallback.length > 0) {
            lines.push('\n**Recommended agents for this task (highest priority first):**');
            for (const a of nonFallback) {
                lines.push(`- ${a.agentId} — ${a.reason}`);
            }
            lines.push(
                '\nWhen delegating via ask_agent, prioritize the agents listed above. ' +
                'Do not delegate to unlisted agents unless the task explicitly requires it.'
            );
        }

        if (agentPipeline && agentPipeline.length > 0) {
            lines.push('\n**Suggested execution pipeline (respect this order):**');
            agentPipeline.forEach((phase, i) => {
                lines.push(`${i + 1}. [${phase.phase}] ${phase.agentId} — ${phase.purpose}`);
            });
        }

        if (requiredGates.length > 0) {
            lines.push(`\n**Required gates before commit:** ${requiredGates.join(', ')}`);
            lines.push('Ensure each gate is satisfied before considering the task complete.');
        }

        return lines.join('\n');
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

    /**
     * Merges the orchestrator's current-turn analysis with the explicit context the
     * LLM provided in the ask_agent call. The analysis (streamBuffer) gives specialists
     * the reasoning and data the orchestrator gathered before delegating.
     */
    private buildSubAgentContext(explicit: string | undefined, orchestratorAnalysis: string): string | undefined {
        const trimmed = orchestratorAnalysis.trim();
        if (!explicit && !trimmed) return undefined;
        const parts: string[] = [];
        if (explicit) parts.push(explicit);
        if (trimmed) parts.push(`## Análisis del orquestador\n${trimmed}`);
        return parts.join('\n\n');
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

            const systemMsg: LLMMessage = { role: 'system', content: this.buildSystemPrompt(currentProfile, orchestrationResult) };
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
                        this.opts.transport.emit({ type: 'token', content: delta, agent_id: currentProfile.id });
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
                    context: this.buildSubAgentContext(c.context, streamBuffer),
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
                const result = await this.executeToolCall(call, currentProfile);
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }

            // ── QA orchestration: runs when response is final (no tool calls) ─
            if (toolResults.length === 0 && this.opts.orchestrator && this.opts.qaService && orchestrationResult) {
                const qaAgentId = this.opts.agents.has('qa-engineer') ? 'qa-engineer' : undefined;
                const qaCtx = {
                    clean: streamBuffer,
                    orchestrationResult,
                    orchestrator: this.opts.orchestrator,
                    qaService: this.opts.qaService,
                    allAgents: this.opts.agents.getAll(),
                    messages: this.messages,
                    effectiveAgentId: currentProfile.id,
                    defaultAgentId: this.opts.defaultAgentId,
                    qaAgentId,
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

                if (qaAgentId && currentProfile.id === qaAgentId) {
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

        // Inject recent history from the orchestrator's conversation so specialists
        // can see previously gathered data (file reads, command outputs, etc.)
        // without requiring the orchestrator to manually copy it into context.
        let historySlice: LLMMessage[] = [];
        const maxCtxMsgs = this.opts.subAgentContextMessages;
        if (maxCtxMsgs && maxCtxMsgs > 0 && this.messages.length > 0) {
            historySlice = this.messages.slice(-maxCtxMsgs);
            // Trim to the first user-turn boundary to avoid orphaning tool results.
            const firstUser = historySlice.findIndex(m => m.role === 'user');
            if (firstUser > 0) historySlice = historySlice.slice(firstUser);
            else if (firstUser < 0) historySlice = [];
        }

        const messages: LLMMessage[] = [
            { role: 'system', content: this.buildSystemPrompt(profile) },
            ...historySlice,
            { role: 'user', content: context ? `${question}\n\nContexto:\n${context}` : question },
        ];

        let finalContent = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
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
                    this.opts.transport.emit({ type: 'token', content: delta, agent_id: profile.id });
                },
                onToolCall: (name, args, id) => {
                    this.opts.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 80) });
                    toolCalls.push({ id, name, args });
                },
                onDone: (msg) => { finalMessage = msg; },
                onError: (err) => { throw err; },
                onMetrics: (inputTokens, outputTokens) => {
                    totalInputTokens += inputTokens;
                    totalOutputTokens += outputTokens;
                    this.opts.transport.emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens });
                },
            });

            if (!finalMessage) break;
            if (streamContent) finalContent = streamContent;
            messages.push(finalMessage);

            if (toolCalls.length === 0) break;

            const toolResults: LLMMessage[] = [];
            for (const call of toolCalls) {
                const result = await this.executeToolCall(call, profile);
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
            messages.push(...toolResults);
        }

        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });

        return { agentId, content: finalContent, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, elapsedMs: Date.now() - start };
    }

    /**
     * Unified tool execution used by both runLoop (primary agent) and
     * runAgentInternal (sub-agents via ask_agent).
     * Handles: allowedTools authorization → onToolApproval gate → execute → audit → transport.
     */
    private async executeToolCall(
        call: { name: string; args: string },
        profile: import('../types').AgentProfile,
    ): Promise<string> {
        const callStart = Date.now();
        const toolDef = this.opts.tools.get(call.name);
        let result: string;

        if (!toolDef) {
            result = `Tool "${call.name}" not found`;
        } else if (
            !profile.allowedTools.includes(call.name) &&
            (profile.allowedTools.length > 0 || (profile.delegatesTo && profile.delegatesTo.length > 0))
        ) {
            result = `Tool "${call.name}" is not authorized for agent "${profile.id}". ` +
                     `Use ask_agent to delegate to a specialist.`;
        } else if (
            !this.approvalDisabled &&
            this.opts.onToolApproval &&
            AgentEngine.WRITE_TOOLS.has(call.name)
        ) {
            const preview = call.args.slice(0, 200);
            this.opts.transport.emit({
                type: 'tool_approval_request',
                tool_name: call.name,
                agent_id: profile.id,
                args_preview: preview,
            });
            const decision = await this.opts.onToolApproval(call.name, profile.id, preview);
            if (decision === 'approve_all') this.approvalDisabled = true;
            result = decision === 'reject'
                ? `Tool call "${call.name}" was rejected by the user.`
                : await this.runToolDef(call, toolDef, profile.id);
        } else {
            result = await this.runToolDef(call, toolDef, profile.id);
        }

        const success = !result.startsWith('Error:');
        this.writeAuditRecord(profile.id, call.name, call.args, success, Date.now() - callStart);
        this.opts.transport.emit({ type: 'tool_result', name: call.name, success, preview: result.slice(0, 120) });
        return result;
    }

    private async runToolDef(
        call: { name: string; args: string },
        toolDef: import('../types').ToolDefinition,
        agentId: string,
    ): Promise<string> {
        const ctx = this.buildContext(agentId);
        try {
            const args = JSON.parse(call.args);
            return await toolDef.execute(args, ctx);
        } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    /** Disable approval gate for the rest of this session (approve_all). */
    disableToolApproval(): void { this.approvalDisabled = true; }

    /** Re-enable approval gate (e.g. after /iteration manual). */
    enableToolApproval(): void { this.approvalDisabled = false; }

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
        appendFileSync(this.opts.auditLog, line + '\n');
    }

    private buildContext(agentId?: string): ExecutionContext {
        return {
            agentId: agentId ?? this.currentAgentId,
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

function toTitleCase(s: string): string {
    return s
        .replace(/[-_](.)/g, (_, c: string) => ' ' + c.toUpperCase())
        .replace(/^(.)/, (c: string) => c.toUpperCase());
}
