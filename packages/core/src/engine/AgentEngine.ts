import { ApprovalGate } from './ApprovalGate';
import { AuditLogger } from './AuditLogger';
import { HistoryManager, sanitizeMessages } from './HistoryManager';
import { MCPRegistrar } from './MCPRegistrar';
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
import type { CommandContext } from '../commands/SlashCommandRegistry';
import { WorkflowRunner } from '../workflow/WorkflowRunner';
import type { WorkflowDef, WorkflowResult, WorkflowRunOptions } from '../workflow/types';
import type { WorkflowBuilder } from '../workflow/WorkflowBuilder';
import type { Orchestrator } from '../orchestration/orchestrator';
import type { OrchestrationResult } from '../orchestration/types';
import type { QAService } from '../qa/qa-service';
import { IterationManager, type IterationMode, type IterationStats } from './IterationManager';
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
    /**
     * Iteration mode. Default: 'interactive'.
     *   interactive  — pauses every maxIterations steps and calls onIterationLimit so the
     *                  user can inspect progress and decide whether to continue (+batchSize more)
     *   auto         — never pauses; runs until the agent finishes or hits the global cap (1000)
     *   step-by-step — calls onStep after every single iteration; maximum user control
     */
    iterationMode?: IterationMode;
    /**
     * Called when maxIterations is reached in interactive mode.
     * Return true to continue (+25 iterations), false to stop.
     */
    onIterationLimit?: (stats: IterationStats) => Promise<boolean>;
    /**
     * Called after every iteration in step-by-step mode.
     * Return true to continue, false to stop.
     */
    onStep?: (stats: IterationStats) => Promise<boolean>;
    /** Observability manager — pre-created and transport-wrapped by createBaseEngine */
    observabilityManager?: ObservabilityManager;
    /** Advanced memory system — episodic/semantic/procedural */
    memorySystem?: MemorySystem;
    /**
     * Extra directories (absolute paths) that file tools are allowed to access
     * beyond workingDir. Useful for exposing ~/.{agentName}/ or shared library
     * roots to the agent without changing workingDir.
     */
    additionalRoots?: string[];
    /** Called once on the first run/runWorkflow to load discovered agents from disk or remote. */
    loadAgents?: () => Promise<import('../types').AgentProfile[]>;
    /**
     * Path to an append-only NDJSON file for tool call audit records.
     * Each executed tool call is appended as one JSON line with: ts, session, agent, tool, inputPreview, success, durationMs.
     * Directory is created automatically. Optional — no audit file written when absent.
     */
    auditLog?: string;
    /**
     * Called by updateWorkingDir after the workingDir changes (e.g. /workspace switch).
     * Should return the new projectContext string built from the new cwd
     * (AGENT.md, session.md, store context, detected stack, etc.).
     * The engine updates opts.projectContext with the returned value so the
     * next system prompt reflects the switched project without an engine restart.
     */
    projectContextLoader?: (cwd: string) => Promise<string | undefined>;
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
    private readonly history: HistoryManager;
    private readonly auditLogger: AuditLogger;
    private currentAgentId: string;
    private aborted = false;
    private abortController: AbortController | null = null;
    private allSkills: Skill[];
    private iterationManager: IterationManager;
    private activeSkillAddition = '';
    private yamlSkillsLoaded = false;
    private readonly mcpRegistrar: MCPRegistrar;
    private readonly approvalGate: ApprovalGate;
    private pendingContextLoad: Promise<void> | null = null;
    private agentsLoaded = false;
    private agentsLoadedPromise: Promise<void> | null = null;
    private memoryContextBlock = '';
    /** Serializes concurrent run() calls — shared mutable state is not reentrant-safe. */
    private runMutex: Promise<void> = Promise.resolve();

    constructor(private readonly opts: AgentEngineOptions) {
        this.memory = opts.sessionMemory ?? new SessionMemory();
        this.currentAgentId = opts.defaultAgentId;
        this.allSkills = opts.skills ?? [];
        this.history = new HistoryManager({
            historyPath:        opts.historyPath,
            maxContextMessages: opts.maxContextMessages,
        });
        this.auditLogger = new AuditLogger(opts.auditLog);
        this.mcpRegistrar = new MCPRegistrar({
            mcpManager: opts.mcpManager,
            tools:      opts.tools,
            agents:     opts.agents,
            transport:  opts.transport,
        });
        this.approvalGate = new ApprovalGate({
            onToolApproval: opts.onToolApproval,
            transport:      opts.transport,
        });
        this.iterationManager = new IterationManager({
            mode: opts.iterationMode ?? 'interactive',
            maxIterations: opts.maxIterations ?? 100,
            onLimitReached: opts.onIterationLimit,
            onStep: opts.onStep,
        });
        this.bus = new DelegationBus({
            maxParallel: opts.maxParallelAgents ?? 6,
            agents: opts.agents,
            transport: opts.transport,
            runAgent: (id, question, context, depth, buf) => this.runAgentInternal(id, question, context, depth, buf),
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

    /**
     * Updates the working directory used by tools and the system prompt.
     * Call after a workspace/project switch so file operations target the new
     * project root without recreating the entire engine.
     * Also triggers a skill reload so project-scoped skills are refreshed.
     * If projectContextLoader is configured, fires it asynchronously so the next
     * run() picks up the new project's AGENT.md / session.md content.
     */
    updateWorkingDir(newCwd: string): void {
        (this.opts as { workingDir?: string }).workingDir = newCwd;
        this.reloadSkills();
        if (this.opts.projectContextLoader) {
            this.pendingContextLoad = this.opts.projectContextLoader(newCwd)
                .then(ctx => {
                    if (ctx !== undefined) {
                        (this.opts as { projectContext?: string }).projectContext = ctx;
                    }
                })
                .catch(() => { /* non-fatal — next run continues without updated context */ })
                .finally(() => { this.pendingContextLoad = null; });
        }
    }

    /**
     * Injects an informational message into the active conversation history so
     * the agent sees it on the next iteration. Used by /workspace switch and any
     * command that needs to surface state changes (cwd, project context, etc.)
     * without requiring a full engine restart.
     */
    injectContext(message: string): void {
        this.history.inject(message);
    }

    /**
     * Returns a partial CommandContext pre-wired to this engine instance.
     * Spread into the registry.dispatch() call so host apps don't need to
     * manually wire onCwdChange, injectContext, setIterationMode, etc.:
     *
     *   await registry.dispatch(input, {
     *     ...engine.getCommandBindings(),
     *     emit, appName: 'my-agent',
     *   });
     */
    getCommandBindings(): Partial<CommandContext> {
        return {
            onCwdChange:      (cwd: string, contextMessage?: string) => {
                this.updateWorkingDir(cwd);
                if (contextMessage) this.injectContext(contextMessage);
            },
            injectContext:    (message: string) => this.injectContext(message),
            setIterationMode: (mode) => this.setIterationMode(mode),
            getIterationMode: () => this.getIterationMode(),
            llm:              (prompt: string) => this.callLLM(prompt),
            reloadSkills:     async () => { this.reloadSkills(); },
            mcpList:          async () => {
                const mgr = this.opts.mcpManager;
                if (!mgr) return [];
                const configured = mgr.getConfiguredNames();
                const connected  = new Map(
                    mgr.getServerInfo().map(s => [s.name, s.toolCount])
                );
                return configured.map(name => ({
                    name,
                    url:       mgr.getConfig(name)?.url,
                    connected: connected.has(name),
                    toolCount: connected.get(name) ?? 0,
                }));
            },
        };
    }

    /**
     * Marks YAML skills as stale so the next run() reloads them from disk.
     * Call after installing, creating, or generating skills so changes take effect
     * without restarting the engine.
     * Built-in (in-memory) skills are never affected — only the YAML layers are reloaded.
     */
    reloadSkills(): void {
        const builtins = this.opts.skills ?? [];
        this.allSkills = [...builtins];
        this.yamlSkillsLoaded = false;
    }

    /**
     * Direct single-turn LLM call — no tools, no conversation history, no transport events.
     * Useful for slash commands that need AI-generated content (e.g. /skills generate).
     * Uses the engine's default provider and model.
     */
    async callLLM(prompt: string): Promise<string> {
        const provider = this.opts.providers.resolve(undefined, this.opts.defaultProvider);
        return new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            provider.chat(
                [{ role: 'user', content: prompt }],
                [],
                {
                    onChunk(delta) { chunks.push(delta); },
                    onDone()       { resolve(chunks.join('')); },
                    onError(err)   { reject(err); },
                },
            );
        });
    }

    private getProviderForProfile(profile: AgentProfile): LLMProvider {
        return this.opts.providers.resolve(profile.provider, this.opts.defaultProvider);
    }

    async run(input: string): Promise<void> {
        // Serialize concurrent calls — messages, currentAgentId, and other fields are
        // shared mutable state that is not safe for concurrent access.
        let release!: () => void;
        const slot = new Promise<void>(r => { release = r; });
        const prev = this.runMutex;
        this.runMutex = prev.then(() => slot);
        await prev;
        try {
            await this._run(input);
        } finally {
            release();
        }
    }

    private async _run(input: string): Promise<void> {
        if (this.pendingContextLoad) await this.pendingContextLoad;
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

        await this.mcpRegistrar.ensureInitialized();
        await this.ensureAgentsLoaded();

        // Direct MCP routing: bypass general when input matches a configured trigger
        const mcpRoute = this.mcpRegistrar.findRoute(input);
        if (mcpRoute) {
            if (mcpRoute.tool) {
                // Tool trigger: call the MCP tool directly — no intermediate LLM.
                // Route through executeToolCall so auth checks and onToolApproval gate apply.
                const toolName = `mcp__${mcpRoute.agentId}__${mcpRoute.tool}`;
                const toolDef = this.opts.tools.get(toolName);
                if (toolDef) {
                    const required = (toolDef.parameters as { required?: string[] }).required;
                    const firstParam = required?.[0] ?? 'input';
                    const mcpProfile = this.opts.agents.get(mcpRoute.agentId) ?? this.getCurrentProfile();
                    if (!mcpProfile) {
                        throw new Error(
                            `MCP route matched agent "${mcpRoute.agentId}", but it is not registered ` +
                            `and no current agent profile is available.`
                        );
                    }
                    this.opts.transport.emit({
                        type: 'block_start',
                        agent_id: mcpRoute.agentId,
                        agent_name: mcpProfile.name ?? mcpRoute.agentId,
                        agent_icon: mcpProfile.icon ?? '◎',
                    });
                    const result = await this.executeToolCall(
                        { name: toolName, args: JSON.stringify({ [firstParam]: input }) },
                        mcpProfile,
                    );
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

        this.history.push({ role: 'user', content: input });
        await this.runLoop(profile, orchestrationResult);
        this.saveHistory();
        this.opts.transport.emit({ type: 'done' });
    }

    async runWorkflow(
        defOrBuilder: WorkflowDef | WorkflowBuilder,
        opts: WorkflowRunOptions = {},
    ): Promise<WorkflowResult> {
        if (this.pendingContextLoad) await this.pendingContextLoad;
        await this.mcpRegistrar.ensureInitialized();
        await this.ensureAgentsLoaded();
        const def = 'build' in defOrBuilder ? defOrBuilder.build() : defOrBuilder;
        const runner = new WorkflowRunner(def, {
            ...opts,
            runAgent: (agentId, input, context) => this.runAgentInternal(agentId, input, context, 0),
            transport: this.opts.transport,
        });
        return runner.run();
    }

    abort(): void {
        this.aborted = true;
        this.abortController?.abort();
        this.abortController = null;
    }

    /** Change the iteration mode at runtime — takes effect on the next run(). */
    setIterationMode(mode: IterationMode): void {
        this.iterationManager.setMode(mode);
    }

    /** Returns the current iteration mode. */
    getIterationMode(): IterationMode {
        return this.iterationManager.mode;
    }

    /** Delete persisted history file and reset in-memory conversation. */
    clearHistory(): void {
        this.history.clear();
    }

    private saveHistory(): void {
        this.history.save();
    }

    private trimHistory(): void {
        const max = this.opts.maxContextMessages;
        if (!max) return;
        const dropped = this.history.trim(max);
        if (dropped > 0) {
            this.opts.transport.emit({
                type: 'system',
                level: 'warn',
                text: `[ContextWindow] Dropped ${dropped} messages — history capped at ${max} (maxContextMessages)`,
            });
        }
    }

    private async ensureAgentsLoaded(): Promise<void> {
        if (this.agentsLoaded || !this.opts.loadAgents) return;
        // Cache the promise so concurrent run() calls wait for the same load,
        // rather than the early-flag pattern that let callers proceed unguarded.
        if (this.agentsLoadedPromise) return this.agentsLoadedPromise;
        this.agentsLoadedPromise = this._loadAgentsOnce();
        return this.agentsLoadedPromise;
    }

    private async _loadAgentsOnce(): Promise<void> {
        try {
            const discovered = await this.opts.loadAgents!();
            for (const agent of discovered) this.opts.agents.upsert(agent);
            if (!this.opts.agents.has(this.currentAgentId)) {
                const all = this.opts.agents.getAll();
                if (all.length > 0) this.currentAgentId = all[0].id;
            }
        } catch (err) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `[AgentDiscovery] Failed to load agents: ${(err as Error).message}`,
            });
        } finally {
            this.agentsLoaded = true;
        }
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
        // Per-agent session notes (tool quirks, learnings routed by LearningRouter)
        const agentNotes = this.opts.store?.getAgentNotes?.(profile.id);
        if (agentNotes) parts.push(`## Agent Session Notes\n${agentNotes}`);
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
        if (profile.id === this.opts.defaultAgentId) {
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
        if (trimmed) parts.push(`## Orchestrator Analysis\n${trimmed}`);
        return parts.join('\n\n');
    }

    private async runLoop(profile: AgentProfile, orchestrationResult?: OrchestrationResult): Promise<void> {
        let currentProfile = profile;

        this.iterationManager.reset();
        const iterManager = this.iterationManager;

        this.opts.transport.emit({
            type: 'block_start',
            agent_id: profile.id,
            agent_name: profile.name,
            agent_icon: profile.icon,
        });

        while (!this.aborted) {
            const shouldContinue = await iterManager.advance();
            if (!shouldContinue) break;

            this.trimHistory();

            const systemMsg: LLMMessage = { role: 'system', content: this.buildSystemPrompt(currentProfile, orchestrationResult) };
            const tools = this.getToolsForAgent(currentProfile);
            const safeHistory = this.history.sanitized();

            let streamBuffer = '';
            const askAgentCalls: Array<{ id: string; agentId: string; question: string; context?: string }> = [];
            const otherCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;

            this.abortController = new AbortController();
            const signal = this.abortController.signal;

            await this.getProviderForProfile(currentProfile).chat(
                [systemMsg, ...safeHistory],
                tools,
                {
                    onChunk: (delta) => {
                        streamBuffer += delta;
                        this.opts.transport.emit({ type: 'token', content: delta, agent_id: currentProfile.id });
                    },
                    onToolCall: (name, args, id) => {
                        this.opts.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 200) });
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
                        if (!this.aborted) this.opts.transport.emit({ type: 'error', message: err.message });
                    },
                    onMetrics: (inputTokens, outputTokens) => {
                        this.opts.transport.emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens });
                    },
                    signal,
                    model: currentProfile.model,
                }
            );

            this.abortController = null;
            if (this.aborted) break;

            if (!finalMessage) break;

            this.history.push(finalMessage);

            const toolResults: LLMMessage[] = [];

            // ── ask_agent: parallel if 2+ calls ──────────────────────────────
            if (askAgentCalls.length > 0) {
                const validCalls = askAgentCalls.filter(c => c.agentId !== currentProfile.id);
                const selfCalls  = askAgentCalls.filter(c => c.agentId === currentProfile.id);

                for (const call of selfCalls) {
                    const msg = `Self-delegation blocked: agent "${currentProfile.id}" cannot delegate to itself. Execute the task directly.`;
                    this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: false, preview: msg });
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: msg });
                }

                if (validCalls.length > 0) {
                    const requests = validCalls.map(c => ({
                        agentId:     c.agentId,
                        question:    c.question,
                        context:     this.buildSubAgentContext(c.context, streamBuffer),
                        fromAgentId: currentProfile.id,
                    }));

                    const results = validCalls.length >= 2
                        ? await this.bus.runParallel(requests)
                        : [await this.bus.runSingle(requests[0])];

                    for (let i = 0; i < validCalls.length; i++) {
                        const call = validCalls[i];
                        const result = results[i];
                        const content = result.error ? `Error: ${result.error}` : result.content;
                        this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: !result.error, preview: content.slice(0, 120) });
                        toolResults.push({ role: 'tool', tool_call_id: call.id, content });
                    }
                }
            }

            // ── other tools: sequential ───────────────────────────────────────
            for (const call of otherCalls) {
                if (this.aborted) break;
                iterManager.recordToolCall();
                const result = await this.executeToolCall(call, currentProfile, 0);
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
                    messages: this.history.getAll(),
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
            this.history.pushAll(toolResults);
        }

        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
    }

    private async runAgentInternal(agentId: string, question: string, context?: string, depth = 0, outputBuffer?: import('../types').AgentEvent[]): Promise<{ agentId: string; content: string; inputTokens: number; outputTokens: number; elapsedMs: number }> {
        const profile = this.opts.agents.get(agentId);
        if (!profile) throw new Error(`Agent "${agentId}" not registered`);

        const start = Date.now();

        // Inject recent history from the orchestrator's conversation so specialists
        // can see previously gathered data (file reads, command outputs, etc.)
        // without requiring the orchestrator to manually copy it into context.
        let historySlice: LLMMessage[] = [];
        const maxCtxMsgs = this.opts.subAgentContextMessages;
        const allMessages = this.history.getAll();
        if (maxCtxMsgs && maxCtxMsgs > 0 && allMessages.length > 0) {
            historySlice = allMessages.slice(-maxCtxMsgs);
            // Trim to the first user-turn boundary to avoid orphaning tool results.
            const firstUser = historySlice.findIndex(m => m.role === 'user');
            if (firstUser > 0) historySlice = historySlice.slice(firstUser);
            else if (firstUser < 0) historySlice = [];
            historySlice = sanitizeMessages(historySlice);
        }

        const messages: LLMMessage[] = [
            { role: 'system', content: this.buildSystemPrompt(profile) },
            ...historySlice,
            { role: 'user', content: context ? `${question}\n\nContext:\n${context}` : question },
        ];

        let finalContent = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const maxIter = this.opts.maxIterations ?? 100;
        let iter = 0;

        // When running in parallel (outputBuffer provided), route output events to the
        // buffer instead of the real transport. The caller flushes the buffer atomically
        // after the agent finishes, preventing interleaved output from parallel agents.
        // tool_approval_request always bypasses buffering — it needs an immediate response.
        const emit = (event: import('../types').AgentEvent): void => {
            if (outputBuffer) outputBuffer.push(event);
            else this.opts.transport.emit(event);
        };

        emit({ type: 'block_start', agent_id: profile.id, agent_name: profile.name, agent_icon: profile.icon });

        while (iter < maxIter) {
            iter++;

            let streamContent = '';
            const toolCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;

            await this.getProviderForProfile(profile).chat(messages, this.getToolsForAgent(profile), {
                onChunk: (delta) => {
                    streamContent += delta;
                    if (!profile.suppressDefaultOutput) {
                        emit({ type: 'token', content: delta, agent_id: profile.id });
                    }
                },
                onToolCall: (name, args, id) => {
                    if (!profile.suppressDefaultOutput) {
                        emit({ type: 'tool_call', name, args_preview: args.slice(0, 200) });
                    }
                    toolCalls.push({ id, name, args });
                },
                onDone: (msg) => { finalMessage = msg; },
                onError: (err) => { throw err; },
                onMetrics: (inputTokens, outputTokens) => {
                    totalInputTokens += inputTokens;
                    totalOutputTokens += outputTokens;
                    emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens });
                },
                model: profile.model,
            });

            if (!finalMessage) break;
            if (streamContent) finalContent = streamContent;
            messages.push(finalMessage);

            if (toolCalls.length === 0) break;

            const toolResults: LLMMessage[] = [];
            for (const call of toolCalls) {
                const result = await this.executeToolCall(call, profile, depth, emit);
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
            messages.push(...toolResults);
        }

        emit({ type: 'block_end', status: 'ok', agent_id: profile.id });

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
        depth = 0,
        emit?: (event: import('../types').AgentEvent) => void,
    ): Promise<string> {
        const emitEvent = emit ?? ((e) => this.opts.transport.emit(e));
        const callStart = Date.now();
        const toolDef = this.opts.tools.get(call.name);
        let result: string;
        let success: boolean;

        if (!toolDef) {
            result  = `Tool "${call.name}" not found`;
            success = false;
        } else if (
            !profile.allowedTools.includes(call.name) &&
            (profile.allowedTools.length > 0 || (profile.delegatesTo && profile.delegatesTo.length > 0))
        ) {
            result  = `Tool "${call.name}" is not authorized for agent "${profile.id}". ` +
                      `Use ask_agent to delegate to a specialist.`;
            success = false;
        } else {
            const gateDecision = await this.approvalGate.check(call, profile.id);
            if (gateDecision === 'rejected') {
                result = `Tool call "${call.name}" was rejected by the user.`; success = false;
            } else {
                ({ result, success } = await this.runToolDef(call, toolDef, profile.id, depth));
            }
        }

        await this.auditLogger.log({ agentId: profile.id, tool: call.name, inputPreview: call.args, success, durationMs: Date.now() - callStart, sessionId: this.opts.sessionId });
        // Strip ANSI before slicing to avoid partial escape sequences in the preview
        // eslint-disable-next-line no-control-regex
        const cleanPreview = result.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        emitEvent({ type: 'tool_result', name: call.name, success, preview: cleanPreview.slice(0, 120) });
        return result;
    }

    private async runToolDef(
        call: { name: string; args: string },
        toolDef: import('../types').ToolDefinition,
        agentId: string,
        depth = 0,
    ): Promise<{ result: string; success: boolean }> {
        const ctx = this.buildContext(agentId, depth);
        try {
            const args = JSON.parse(call.args);
            return { result: await toolDef.execute(args, ctx), success: true };
        } catch (err) {
            return { result: `Error: ${err instanceof Error ? err.message : String(err)}`, success: false };
        }
    }

    /**
     * Disconnects an MCP server at runtime — reverts all tool assignments and
     * command blocks it applied to local agents. After calling this, agents that
     * had tools from this server lose them from allowedTools, and any commands
     * that were blocked via blocksCommands are unblocked.
     *
     * For mode='agent' servers, the wrapper agent is also removed from the roster.
     * For mode='tools' servers, agents fall back to shell commands automatically.
     */
    unregisterMCPServer(serverName: string): void {
        this.mcpRegistrar.unregisterServer(serverName);
    }

    /** Disable approval gate for the rest of this session (approve_all). */
    disableToolApproval(): void { this.approvalGate.disable(); }

    /** Re-enable approval gate (e.g. after /iteration manual). */
    enableToolApproval(): void { this.approvalGate.enable(); }


    private buildContext(agentId?: string, depth = 0): ExecutionContext {
        const id = agentId ?? this.currentAgentId;
        const profile = this.opts.agents.get(id);
        const storeRoot = this.opts.store?.projectDir;
        const additionalRoots = [
            ...(this.opts.additionalRoots ?? []),
            ...(storeRoot ? [storeRoot] : []),
        ];
        return {
            agentId: id,
            sessionId: this.opts.sessionId ?? 'default',
            workingDir: this.opts.workingDir,
            memory: this.memory,
            store: this.opts.store,
            advancedMemory: this.opts.memorySystem,
            ...(additionalRoots.length ? { additionalRoots } : {}),
            ...(profile?.blockedCommands?.length ? { blockedCommands: profile.blockedCommands } : {}),
            askAgent: async (agentId, question, context) => {
                const result = await this.bus.runSingle({ agentId, question, context, fromAgentId: id, depth: depth + 1 });
                return result.content;
            },
            emitCompacting: (phase, label) => {
                this.opts.transport.emit({ type: 'compacting', phase, label });
            },
            llmCall: async (prompt: string): Promise<string> => {
                const profile = this.opts.agents.get(id);
                if (!profile) return '';
                const provider = this.getProviderForProfile(profile);
                let result = '';
                await provider.chat(
                    [{ role: 'user', content: prompt }],
                    [],
                    {
                        onChunk:   (d) => { result += d; },
                        onToolCall: () => {},
                        onDone:    () => {},
                        onError:   () => {},
                    },
                );
                return result.trim();
            },
        };
    }
}
