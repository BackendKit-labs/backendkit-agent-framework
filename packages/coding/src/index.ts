import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    createBaseEngine,
    SkillLoader,
    Orchestrator,
    QAService,
    ReflectionEngine,
    createMemorySystem,
    adaptProviderToLLMClient,
    runGlobalSeed,
    type LLMProvider,
    type Transport,
    type Skill,
    type CapabilityMatrix,
    type PolicyRule,
    type MCPServerConfig,
    type ObservabilityConfig,
    getProjectDir,
} from '@backendkit-labs/agent-core';
export type { AgentEngine } from '@backendkit-labs/agent-core';
import { CODING_CAPABILITY_MATRIX } from './orchestration/capability-matrix';
import {
    GLOBAL_BUILTIN_SKILLS,
    NODE_PACK_SKILLS,
    GO_PACK_SKILLS,
    JAVA_PACK_SKILLS,
    KOTLIN_PACK_SKILLS,
    PYTHON_PACK_SKILLS,
} from './skills';
import type { AnthropicCacheMode } from '@backendkit-labs/agent-providers';
import {
    OpenAICompatibleProvider,
    AnthropicProvider,
    OllamaProvider,
    OLLAMA_DEFAULT_HOST,
    OLLAMA_DEFAULT_MODEL,
} from '@backendkit-labs/agent-providers';
import { CODING_AGENTS } from './agents/profiles';
import { buildCodingSandbox } from './sandbox';
import type { CodingSandboxConfig } from './sandbox';
import { AgentLoader } from './agents/AgentLoader';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';
import { listDirectoryTool } from './tools/list-directory';
import { runCommandTool } from './tools/run-command';
import { searchFilesTool } from './tools/search-files';
import { saveContextTool } from './tools/save-context';
import { saveLearningTool } from './tools/save-learning';
import { saveAuditTool, getLatestAuditTool, listAuditsTool } from './tools/save-audit';
import { saveUserPreferenceTool } from './tools/save-user-preference';
import { updateSessionTool } from './tools/update-session';
import { ProjectStore } from './store/ProjectStore';
import { PersistentMemory } from './store/PersistentMemory';
import { ConfigLoader } from './config/ConfigLoader';

// ── Stack detection ───────────────────────────────────────────────────────────

export const STACK_INDICATORS: Array<{ file: string; stack: string }> = [
    { file: 'package.json',         stack: 'node' },
    { file: 'tsconfig.json',        stack: 'typescript' },
    { file: 'requirements.txt',     stack: 'python' },
    { file: 'pyproject.toml',       stack: 'python' },
    { file: 'pom.xml',              stack: 'java' },
    { file: 'build.gradle',         stack: 'java' },
    { file: 'build.gradle.kts',     stack: 'kotlin' },  // Kotlin DSL gradle
    { file: 'settings.gradle.kts',  stack: 'kotlin' },  // Android / Kotlin Multiplatform
    { file: 'Cargo.toml',           stack: 'rust' },
    { file: 'go.mod',               stack: 'go' },
    { file: 'composer.json',        stack: 'php' },
    { file: 'Gemfile',              stack: 'ruby' },
    { file: 'mix.exs',              stack: 'elixir' },
];

function detectProjectStack(cwd: string): string[] {
    const stacks: string[] = [];
    for (const { file, stack } of STACK_INDICATORS) {
        if (existsSync(join(cwd, file)) && !stacks.includes(stack)) {
            stacks.push(stack);
        }
    }
    return stacks;
}

/**
 * Builds the projectContext string for any cwd.
 * Called at startup and re-called by projectContextLoader on /workspace switch.
 * Creates a temporary ProjectStore for reading when none is provided (e.g. after switch).
 */
function buildProjectContext(cwd: string, appName: string, store?: ProjectStore): string | undefined {
    const agentMdPath = join(cwd, 'AGENT.md');
    const agentMd = existsSync(agentMdPath)
        ? readFileSync(agentMdPath, 'utf-8').trim()
        : undefined;

    const effectiveStore = store ?? new ProjectStore(cwd, appName);
    const storeCtx = effectiveStore.buildSystemContext(agentMd);

    const projectDir = getProjectDir(appName, cwd);
    const pipelineParts: string[] = [];
    const tryRead = (p: string) => existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;

    const session = tryRead(join(projectDir, 'memory', 'session.md'));
    if (session) pipelineParts.push(`## Current Session\n${session}`);

    const lecciones = tryRead(join(projectDir, 'audits', 'lecciones-aprendidas.md'));
    if (lecciones) pipelineParts.push(`## Lecciones Aprendidas\n${lecciones}`);

    const detectedStack = detectProjectStack(cwd);
    if (detectedStack.length > 0) {
        pipelineParts.push(`## Detected Project Stack\n${detectedStack.join(', ')}`);
    }

    const pipelineCtx = pipelineParts.join('\n\n');
    const combined = [storeCtx, pipelineCtx].filter(Boolean).join('\n\n');
    return combined || undefined;
}

// ── Re-exports ────────────────────────────────────────────────────────────────
export * from './skills';
export { CODING_CAPABILITY_MATRIX } from './orchestration/capability-matrix';
// The providers live in @backendkit-labs/agent-providers; re-exported here under the same names.
export {
    DeepSeekProvider,
    OpenAICompatibleProvider,
    AnthropicProvider,
    OllamaProvider,
    OLLAMA_DEFAULT_HOST,
    OLLAMA_DEFAULT_MODEL,
} from '@backendkit-labs/agent-providers';
export type {
    OllamaProviderOptions,
    OpenAICompatibleProviderOptions,
    DeepSeekProviderOptions,
    AnthropicProviderOptions,
    AnthropicCacheMode,
} from '@backendkit-labs/agent-providers';
export { CODING_AGENTS } from './agents/profiles';
export { AgentLoader } from './agents/AgentLoader';
export type { AgentLoaderOptions } from './agents/AgentLoader';
export { InitWorkflow } from './workflows/InitWorkflow';
export type { InitMode } from './workflows/InitWorkflow';
export { TerminalTransport } from './transport/TerminalTransport';
export { ProjectStore } from './store/ProjectStore';
export { PersistentMemory } from './store/PersistentMemory';
export { ConfigLoader } from './config/ConfigLoader';
export type { BkAgentConfig } from './config/ConfigLoader';
export * from './tools/read-file';
export * from './tools/write-file';
export * from './tools/edit-file';
export * from './tools/list-directory';
export * from './tools/run-command';
export * from './tools/search-files';
export * from './tools/save-context';
export * from './tools/save-learning';
export * from './tools/save-audit';
export * from './tools/save-user-preference';
export * from './tools/update-session';
export { CODING_WRITE_TOOLS, buildCodingSandbox } from './sandbox';
export type { CodingSandboxConfig, CodingSandboxOptions } from './sandbox';

// ── Tool sets ─────────────────────────────────────────────────────────────────
export const CODING_TOOLS = [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    runCommandTool,
    searchFilesTool,
    saveContextTool,
    saveLearningTool,
    saveAuditTool,
    getLatestAuditTool,
    listAuditsTool,
    saveUserPreferenceTool,
    updateSessionTool,
];

// ── Provider config types ─────────────────────────────────────────────────────

export interface OpenAICompatibleConfig {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
    /** Reasoning toggle for providers that support it (e.g. DeepSeek V4). Omit for the API default. */
    thinking?: 'enabled' | 'disabled';
    /**
     * How `generateObject` / structured output is requested: 'native' (json_schema), 'json_object'
     * (valid JSON only; the schema goes in the prompt) or 'none'. Default: 'json_object' for
     * `deepseek`, 'native' otherwise.
     */
    structuredOutput?: 'native' | 'json_object' | 'none';
}

export interface AnthropicConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Prompt caching: 'none' (default), 'system', 'system+tools' or 'auto'. */
    cache?: AnthropicCacheMode;
    /** Cache lifetime. Default '5m'. */
    cacheTtl?: '5m' | '1h';
    /** Extended thinking; budgetTokens >= 1024 and < maxTokens. */
    thinking?: { budgetTokens: number };
    /** Structured output: 'native' (output_config, default) or 'tool' (forced `respond` tool; not with thinking). */
    structuredOutput?: 'native' | 'tool';
}

export interface OllamaConfig {
    /** Ollama host URL. Default: http://localhost:11434 */
    host?: string;
    /** Model name loaded in Ollama. Default: llama3.2 */
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** 'json_object' (default) or 'native' when your Ollama server supports json_schema. */
    structuredOutput?: 'native' | 'json_object' | 'none';
}

export type ProvidersConfig = {
    deepseek?: OpenAICompatibleConfig;
    openai?: OpenAICompatibleConfig;
    anthropic?: AnthropicConfig;
    ollama?: OllamaConfig;
    kimi?: OpenAICompatibleConfig;
    grok?: OpenAICompatibleConfig;
    [key: string]: OpenAICompatibleConfig | AnthropicConfig | OllamaConfig | undefined;
};

const KNOWN_BASE_URLS: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai:   'https://api.openai.com/v1',
    kimi:     'https://api.moonshot.cn/v1',
    grok:     'https://api.x.ai/v1',
    ollama:   `${OLLAMA_DEFAULT_HOST}/v1`,
};

const DEFAULT_MODELS: Record<string, string> = {
    deepseek:  'deepseek-chat',
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    kimi:      'moonshot-v1-8k',
    grok:      'grok-3',
    ollama:    OLLAMA_DEFAULT_MODEL,
};

// ── Engine options ────────────────────────────────────────────────────────────

export interface OrchestrationOptions {
    /**
     * Enable automatic QA review for responses with substantial code.
     * The qa-engineer agent is triggered automatically for high-risk tasks.
     * Requires the default provider to be configured (used for QA LLM calls).
     * Default: true when orchestration is enabled.
     */
    enableQA?: boolean;
    /** Disable QA reviews even when enableQA is true. */
    noQA?: boolean;
    /** Called when QA generates an inline review. */
    onQAReview?: (review: string) => void;
    /**
     * Capability matrix mapping agent IDs to the technical domains they own.
     * Used for automatic agent selection based on detected domains.
     * Defaults to CODING_CAPABILITY_MATRIX (all 10 coding agents).
     */
    capabilityMatrix?: CapabilityMatrix;
    /** Extra policy rules merged with the default built-in rules. */
    customRules?: PolicyRule[];
    /**
     * Activa el Reflection Engine para auto-aprendizaje cross-sprint.
     *
     * - `true` — crea un ReflectionEngine con defaults (persiste en ~/.{appName}/)
     * - `ReflectionEngine` — usa la instancia provista (control total sobre config y paths)
     *
     * Cuando está activo, al finalizar cada sprint con hallazgos:
     *   1. Los findings se acumulan en el FailureCatalog por proyecto
     *   2. Patrones con ≥3 ocurrencias (high/critical) se promueven a PolicyRules
     *   3. lecciones-aprendidas.md se actualiza con historial cross-sprint
     *
     * Requiere que `orchestration` esté habilitado.
     */
    reflection?: boolean | ReflectionEngine;
}

export interface CodingEngineOptions {
    providers: ProvidersConfig;
    defaultProvider: string;
    defaultAgent?: string;
    workingDir?: string;
    maxIterations?: number;
    maxParallelAgents?: number;
    /** Max concurrencySafe tool calls of one turn run at once. Default 1. */
    maxParallelTools?: number;
    /** Default time limit for one tool call in ms (a tool's own timeout wins). Default: none. Needs agent-core >= 0.29. */
    toolTimeoutMs?: number;
    /** Wait for a tool to wind down after abort/timeout before answering. Default 2000 ms. */
    toolTimeoutGraceMs?: number;
    /**
     * Background jobs: `run_command` gains `background: true` and the agents that can run commands also get
     * `job_output`, `job_list` and `job_kill`. See BaseEngineOptions.jobs. Needs agent-core >= 0.29.
     */
    jobs?: boolean | import('@backendkit-labs/agent-core').JobRegistryOptions;
    /** Resolves `AgentProfile.secrets` references whose env var is unset. Needs agent-core >= 0.29. */
    secretResolver?: (name: string, agentId: string) => string | undefined | Promise<string | undefined>;
    /**
     * Confinement and permissions for what the agents run (SPEC-0006). A ready-made `SandboxRunner`, or a config:
     * `{ preset: 'ask' | 'read-only' | 'auto-edit' | 'full', policy?, backends?, docker?, auditLog? }`.
     * Without it, `run_command` keeps its old behaviour (the host, or `BK_RUN_COMMAND_SANDBOX=docker`, now deprecated).
     * With it, `run_command` fails closed when the required confinement cannot be enforced, write tools are refused in
     * `read-only`, and the preset decides which tools ask for approval (refused when no `onToolApproval` is set).
     * Read the running policy back with `engine.sandbox`. Needs agent-core >= 0.30.
     */
    sandbox?: CodingSandboxConfig;
    /** Tracing, metrics and cost/budget tracking (see createBaseEngine). */
    observability?: ObservabilityConfig;
    /** Abort the run when observability.costTracker.budget is exceeded. Default false. */
    abortOnBudget?: boolean;
    transport?: Transport;
    /**
     * App name used to derive the home config directory (~/.{appName}/).
     * Defaults to 'bk-agent'. Set this to your own app name when building on top of the framework.
     */
    appName?: string;
    /** Skip creating a ProjectStore (e.g. for testing) */
    disablePersistence?: boolean;
    /**
     * External MCP servers to connect to on first run.
     * Tools are discovered lazily and made available to all agents.
     *
     * @example
     * mcpServers: [
     *   { name: 'github',   command: 'npx', args: ['@modelcontextprotocol/server-github'],   env: { GITHUB_TOKEN: '...' } },
     *   { name: 'postgres', command: 'npx', args: ['@modelcontextprotocol/server-postgres'],  env: { DATABASE_URL: '...' } },
     *   { name: 'slack',    command: 'npx', args: ['@modelcontextprotocol/server-slack'],     env: { SLACK_TOKEN: '...' } },
     * ]
     */
    mcpServers?: MCPServerConfig[];
    /**
     * Number of recent messages from the orchestrator's conversation to inject
     * into each sub-agent call. Gives specialists visibility into previously
     * gathered data (file reads, command outputs) without requiring the
     * orchestrator to copy it manually. Sliced at a user-turn boundary.
     * Default: 0. Recommended: 10–20 for complex multi-turn tasks.
     */
    subAgentContextMessages?: number;
    /**
     * Token-aware context control: truncates bulky old tool results and summarizes (or drops) the oldest
     * turns to keep the conversation under `context.maxTokens`. Default: disabled.
     * Needs @backendkit-labs/agent-core >= 0.28.
     */
    context?: import('@backendkit-labs/agent-core').ContextOptions;
    /**
     * Guardrails on user input, tool arguments, tool results and model answers (piiGuardrail,
     * secretLeakGuardrail, promptInjectionGuardrail, ... from agent-core). Applied to every agent.
     * Default: none. Needs @backendkit-labs/agent-core >= 0.28.
     */
    guardrails?: import('@backendkit-labs/agent-core').Guardrail[];
    /** `after` (default) or `buffer`; see agent-core BaseEngineOptions.guardrailOutputMode. */
    guardrailOutputMode?: 'after' | 'buffer';
    /**
     * Called before executing write/execute tools (write_file, edit_file, run_command) when
     * iteration mode is manual. Return 'approve', 'approve_all', or 'reject'.
     */
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<import('@backendkit-labs/agent-core').ToolApprovalDecision>;
    /**
     * Called when maxIterations is reached in 'interactive' mode.
     * Return true to continue, false to stop.
     */
    onIterationLimit?: (stats: import('@backendkit-labs/agent-core').IterationStats) => Promise<boolean>;
    /**
     * Called after every single iteration in 'step-by-step' mode.
     * Return true to continue, false to stop.
     */
    onStep?: (stats: import('@backendkit-labs/agent-core').IterationStats) => Promise<boolean>;
    /**
     * Activate the Orchestrator pipeline:
     * intent detection → domain detection → risk scoring → policy engine → FSM gates.
     *
     * Pass `true` for all defaults, or an object for fine-grained control.
     *
     * @example
     * // Simple activation
     * orchestration: true
     *
     * @example
     * // With QA auto-review disabled
     * orchestration: { enableQA: false }
     *
     * @example
     * // Custom capability matrix and extra policy rules
     * orchestration: {
     *   capabilityMatrix: { 'my-agent': { owns: ['backend'], skills: [], baseWeight: 0.9 } },
     *   customRules: [{ if: { domain: 'security' }, then: { mustInclude: ['security'] } }],
     * }
     */
    orchestration?: boolean | OrchestrationOptions;
    /**
     * Extra skills injected into the engine in addition to the builtin packs.
     *
     * Unlike project skills loaded from disk via SkillLoader (which is gated behind
     * persistence and therefore disabled when `disablePersistence: true`), these are
     * passed straight through and are always available. This is the supported path
     * for MCP specialist servers (backend-mcp, qa-mcp, …) that run with
     * `disablePersistence: true` but still want their own domain skill packs.
     *
     * Activation is identical to builtins: matched per-run by trigger keywords +
     * stack/language gating, with `systemPromptAddition` injected into the loop's
     * system prompt when active. Skills with `agents: [<id>]` are always-on for those agents.
     */
    extraSkills?: Skill[];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCodingEngine(opts: CodingEngineOptions): ReturnType<typeof createBaseEngine> {
    const cwd     = opts.workingDir ?? process.cwd();
    const appName = opts.appName ?? 'bk-agent';

    // ── Agents (builtins + global + project overrides) ────────────────────────
    const allAgents = AgentLoader.load({ appName, cwd, builtins: CODING_AGENTS });

    // ── Providers (instantiate from config) ───────────────────────────────────
    const providers: Record<string, LLMProvider> = {};
    for (const [id, config] of Object.entries(opts.providers)) {
        if (!config) continue;
        if (id === 'anthropic') {
            const cfg = config as AnthropicConfig;
            providers[id] = new AnthropicProvider({
                apiKey: cfg.apiKey,
                model: cfg.model ?? DEFAULT_MODELS.anthropic,
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
                cache: cfg.cache,
                cacheTtl: cfg.cacheTtl,
                thinking: cfg.thinking,
                structuredOutput: cfg.structuredOutput,
            });
        } else if (id === 'ollama') {
            const cfg = config as OllamaConfig;
            providers[id] = new OllamaProvider({
                host: cfg.host ?? OLLAMA_DEFAULT_HOST,
                model: cfg.model ?? OLLAMA_DEFAULT_MODEL,
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
                structuredOutput: cfg.structuredOutput,
            });
        } else {
            const cfg = config as OpenAICompatibleConfig;
            const baseUrl = cfg.baseUrl ?? KNOWN_BASE_URLS[id];
            if (!baseUrl) throw new Error(`Provider "${id}" requires a baseUrl`);
            providers[id] = new OpenAICompatibleProvider({
                apiKey: cfg.apiKey,
                baseUrl,
                model: cfg.model ?? DEFAULT_MODELS[id] ?? 'gpt-4o',
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
                thinking: cfg.thinking,
                structuredOutput: cfg.structuredOutput ?? (id === 'deepseek' ? 'json_object' : undefined),
                // DeepSeek V4 rejects forced tool choices while it thinks (its default).
                ...(id === 'deepseek' ? { disableThinkingForForcedTools: true } : {}),
            });
        }
    }

    // ── Persistent store + memory ─────────────────────────────────────────────
    let store: ProjectStore | undefined;
    let memory: PersistentMemory | undefined;
    let projectContext: string | undefined;
    let auditLog: string | undefined;
    let historyPath: string | undefined;
    let memorySystem: ReturnType<typeof createMemorySystem> | undefined;

    if (!opts.disablePersistence) {
        store = new ProjectStore(cwd, appName);
        memory = new PersistentMemory(store.projectDir);
        auditLog = join(store.projectDir, 'audits', 'tool-calls.ndjson');
        historyPath = join(store.projectDir, 'memory', 'history.json');
        // Summarize old episodes with the LLM when they pile up.
        // Runs async (fire-and-forget) so it never blocks a tool call.
        const episodicSummarizeFn = async (episodes: import('@backendkit-labs/agent-core').Episode[]): Promise<string> => {
            const provider = providers[opts.defaultProvider] ?? Object.values(providers)[0];
            if (!provider) return episodes.map(e => e.content).join(' | ');
            const list = episodes.map((e, i) =>
                `${i + 1}. ${e.content}${e.tags.length ? ` [${e.tags.join(', ')}]` : ''}`
            ).join('\n');
            const prompt =
                `Summarize these agent experiences into ONE concise paragraph (max 120 words). ` +
                `Preserve key facts, patterns, and outcomes:\n\n${list}`;
            let result = '';
            await provider.chat(
                [{ role: 'user', content: prompt }],
                [],
                { onChunk: (d) => { result += d; }, onToolCall: () => {}, onDone: () => {}, onError: () => {} },
            );
            return result.trim() || episodes.map(e => e.content).join(' | ');
        };

        memorySystem = createMemorySystem({
            episodic:   { provider: 'json', path: join(store.projectDir, 'memory', 'episodes.json') },
            semantic:   { provider: 'json', path: join(store.projectDir, 'memory', 'knowledge.json') },
            procedural: { provider: 'json', path: join(store.projectDir, 'memory', 'patterns.json') },
            retention:  { maxEpisodes: 500, summarizeAfter: 50, summarizeFn: episodicSummarizeFn },
        });

        projectContext = buildProjectContext(cwd, appName, store);
    }

    // ── Skills (3-layer: builtins in-memory + YAML lazy-loaded) ──────────────
    const builtinSkills: Skill[] = [
        ...GLOBAL_BUILTIN_SKILLS,
        ...NODE_PACK_SKILLS,
        ...GO_PACK_SKILLS,
        ...JAVA_PACK_SKILLS,
        ...KOTLIN_PACK_SKILLS,
        ...PYTHON_PACK_SKILLS,
        ...(opts.extraSkills ?? []),   // caller-supplied domain skills (always-on, survives disablePersistence)
    ];
    const skillLoader = opts.disablePersistence ? undefined : new SkillLoader(appName);
    const loadSkills = skillLoader
        ? async () => {
            const loaded = await skillLoader.loadAll(cwd, store?.projectDir);
            return [...loaded.global, ...loaded.packs, ...loaded.projectConfig, ...loaded.project];
        }
        : undefined;

    // ── Orchestrator (optional — activated via opts.orchestration) ────────────
    let orchestrator: Orchestrator | undefined;
    let qaService: QAService | undefined;
    let noQA: boolean | undefined;
    let onQAReview: ((r: string) => void) | undefined;

    if (opts.orchestration) {
        const orchOpts: OrchestrationOptions =
            typeof opts.orchestration === 'boolean' ? {} : opts.orchestration;

        // Adapt the default LLM provider to the simpler LLMChatClient interface
        // used by Orchestrator (intent detection) and QAService (inline review).
        const defaultProviderInstance = providers[opts.defaultProvider];
        const llmClient = defaultProviderInstance
            ? adaptProviderToLLMClient(defaultProviderInstance)
            : undefined;

        orchestrator = new Orchestrator({
            appName,
            projectRoot: cwd,
            client: llmClient,
            capabilityMatrix: orchOpts.capabilityMatrix ?? CODING_CAPABILITY_MATRIX,
            customRules: orchOpts.customRules,
        });

        // reflection defaults to true when orchestration is on — the feedback loop
    // (findings → catalog → patterns → manifest.yaml → PolicyStep) is now complete.
    const reflectionOpt = orchOpts.reflection ?? true;
        if (reflectionOpt) {
            const re = reflectionOpt instanceof ReflectionEngine
                ? reflectionOpt
                : new ReflectionEngine({ projectRoot: cwd, appName });
            // initialize() carga el catálogo desde disco; corre en background porque
            // el primer completeSprint() no ocurre hasta después del primer run LLM.
            re.initialize().catch(() => {});
            orchestrator.getAuditReporter().connectReflectionEngine(re);
        }

        noQA = orchOpts.noQA;
        onQAReview = orchOpts.onQAReview;

        // QAService: auto-builds when enableQA is not explicitly false and LLM is available.
        // Uses the qa-engineer agent's system prompt as the base for QA review calls.
        if (orchOpts.enableQA !== false && llmClient) {
            const qaProfile = allAgents.find(a => a.id === 'qa-engineer');
            qaService = new QAService({
                client: llmClient,
                basePrompt: () => qaProfile?.systemPrompt ?? '',
                allAgents,
                noQA: orchOpts.noQA,
                onQAReview: orchOpts.onQAReview,
            });
        }
    }

    // ── Stack detection (for skill language gating) ───────────────────────────
    const detectedStack = detectProjectStack(cwd);

    // ── Seed global directory structure on first run (fire-and-forget) ───────
    // Creates ~/.{appName}/ with agents, skills, workspaces.json, agent-notes/,
    // and projects/{cwd}/memory+audits dirs. Idempotent — skips existing files.
    runGlobalSeed(appName, cwd, {
        agents: allAgents.filter(a => a.source === 'builtin'),
        skills: builtinSkills,
    }).catch(err => console.warn(`[${appName}] seed warning: ${err.message}`));

    // Agents that can run commands also get the job tools when jobs are on.
    const jobTools = ['job_output', 'job_list', 'job_kill'];
    const engineAgents = opts.jobs
        ? allAgents.map(a => a.allowedTools.includes('run_command')
            ? { ...a, allowedTools: [...new Set([...a.allowedTools, ...jobTools])] }
            : a)
        : allAgents;

    // ── Delegate engine assembly to createBaseEngine ──────────────────────────
    return createBaseEngine({
        providers,
        defaultProvider: opts.defaultProvider,
        agents: engineAgents,
        tools: CODING_TOOLS,
        defaultAgent: opts.defaultAgent ?? 'general',
        transport: opts.transport,
        workingDir: cwd,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
        ...(opts.maxParallelTools ? { maxParallelTools: opts.maxParallelTools } : {}),
        ...(opts.observability ? { observability: opts.observability } : {}),
        ...(opts.abortOnBudget ? { abortOnBudget: true } : {}),
        store,
        projectContext,
        skills: builtinSkills,
        detectedStack,
        loadSkills,
        ...(memory ? { sessionMemory: memory } : {}),
        ...(auditLog ? { auditLog } : {}),
        ...(orchestrator ? { orchestrator } : {}),
        ...(qaService ? { qaService } : {}),
        ...(noQA !== undefined ? { noQA } : {}),
        ...(onQAReview ? { onQAReview } : {}),
        ...(opts.mcpServers?.length ? { mcpServers: opts.mcpServers } : {}),
        ...(opts.onToolApproval ? { onToolApproval: opts.onToolApproval } : {}),
        ...(opts.onIterationLimit ? { onIterationLimit: opts.onIterationLimit } : {}),
        ...(opts.onStep ? { onStep: opts.onStep } : {}),
        ...(opts.subAgentContextMessages ? { subAgentContextMessages: opts.subAgentContextMessages } : {}),
        ...(opts.toolTimeoutMs ? { toolTimeoutMs: opts.toolTimeoutMs } : {}),
        ...(opts.jobs ? { jobs: opts.jobs } : {}),
        ...(opts.sandbox ? { sandbox: buildCodingSandbox(opts.sandbox) } : {}),
        ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
        ...(opts.toolTimeoutGraceMs !== undefined ? { toolTimeoutGraceMs: opts.toolTimeoutGraceMs } : {}),
        ...(opts.context ? { context: opts.context } : {}),
        ...(opts.guardrails?.length ? { guardrails: opts.guardrails } : {}),
        ...(opts.guardrailOutputMode ? { guardrailOutputMode: opts.guardrailOutputMode } : {}),
        ...(memorySystem ? { memorySystem } : {}),
        ...(historyPath ? { historyPath } : {}),
        // Only rebuild project context on switch when persistence is enabled —
        // buildProjectContext creates a ProjectStore (writes dirs + session.md),
        // which would violate disablePersistence.
        ...(opts.disablePersistence
            ? {}
            : { projectContextLoader: async (newCwd: string) => buildProjectContext(newCwd, appName) }),
    });
}

// ── Config-based factory (reads ~/.bk-agent/config.json) ─────────────────────

export function createCodingEngineFromConfig(overrides: Partial<CodingEngineOptions> = {}): ReturnType<typeof createBaseEngine> {
    const appName = overrides.appName ?? 'bk-agent';
    const loader = new ConfigLoader(appName);
    const config = loader.load();

    if (!config.defaultProvider) {
        throw new Error(
            `No provider configured. Set DEEPSEEK_API_KEY or add providers to ${loader.configPath}`
        );
    }

    const providers: ProvidersConfig = {};
    for (const [id, cfg] of Object.entries(config.providers ?? {})) {
        if (cfg?.apiKey) providers[id] = cfg as OpenAICompatibleConfig;
    }

    return createCodingEngine({
        providers,
        defaultProvider: config.defaultProvider,
        ...(config.mcpServers?.length ? { mcpServers: config.mcpServers } : {}),
        ...overrides,
        appName,
    });
}
