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
    type LLMProvider,
    type Transport,
    type Skill,
    type CapabilityMatrix,
    type PolicyRule,
    type MCPServerConfig,
    getProjectDir,
} from '@bk/agent-core';
export type { AgentEngine } from '@bk/agent-core';
import { CODING_CAPABILITY_MATRIX } from './orchestration/capability-matrix';
import {
    GLOBAL_BUILTIN_SKILLS,
    NODE_PACK_SKILLS,
    GO_PACK_SKILLS,
    JAVA_PACK_SKILLS,
    KOTLIN_PACK_SKILLS,
    PYTHON_PACK_SKILLS,
} from './skills';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { CODING_AGENTS } from './agents/profiles';
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

const STACK_INDICATORS: Array<{ file: string; stack: string }> = [
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

// ── Re-exports ────────────────────────────────────────────────────────────────
export * from './skills';
export { CODING_CAPABILITY_MATRIX } from './orchestration/capability-matrix';
export { DeepSeekProvider } from './providers/DeepSeekProvider';
export { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
export { AnthropicProvider } from './providers/AnthropicProvider';
export { CODING_AGENTS } from './agents/profiles';
export { AgentLoader } from './agents/AgentLoader';
export type { AgentLoaderOptions } from './agents/AgentLoader';
export { InitWorkflow } from './workflows/InitWorkflow';
export type { InitMode } from './workflows/InitWorkflow';
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
}

export interface AnthropicConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

export type ProvidersConfig = {
    deepseek?: OpenAICompatibleConfig;
    openai?: OpenAICompatibleConfig;
    anthropic?: AnthropicConfig;
    kimi?: OpenAICompatibleConfig;
    grok?: OpenAICompatibleConfig;
    [key: string]: OpenAICompatibleConfig | AnthropicConfig | undefined;
};

const KNOWN_BASE_URLS: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai:   'https://api.openai.com/v1',
    kimi:     'https://api.moonshot.cn/v1',
    grok:     'https://api.x.ai/v1',
};

const DEFAULT_MODELS: Record<string, string> = {
    deepseek:  'deepseek-chat',
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    kimi:      'moonshot-v1-8k',
    grok:      'grok-3',
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
     * Called before executing write/execute tools (write_file, edit_file, run_command) when
     * iteration mode is manual. Return 'approve', 'approve_all', or 'reject'.
     */
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<import('@bk/agent-core').ToolApprovalDecision>;
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
        memorySystem = createMemorySystem({
            episodic:   { provider: 'json', path: join(store.projectDir, 'memory', 'episodes.json') },
            semantic:   { provider: 'json', path: join(store.projectDir, 'memory', 'knowledge.json') },
            procedural: { provider: 'json', path: join(store.projectDir, 'memory', 'patterns.json') },
            retention:  { maxEpisodes: 500 },
        });

        const agentMdPath = join(cwd, 'AGENT.md');
        const agentMd = existsSync(agentMdPath)
            ? readFileSync(agentMdPath, 'utf-8').trim()
            : undefined;

        const projectDir = getProjectDir(appName, cwd);
        const pipelineParts: string[] = [];
        const tryRead = (p: string) => existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;

        const sesion = tryRead(join(projectDir, 'memory', 'session.md'));
        if (sesion) pipelineParts.push(`## Current Session\n${sesion}`);

        const lecciones = tryRead(join(projectDir, 'audits', 'lecciones-aprendidas.md'));
        if (lecciones) pipelineParts.push(`## Lecciones Aprendidas\n${lecciones}`);

        const storeCtx = store.buildSystemContext(agentMd) || '';
        const pipelineCtx = pipelineParts.join('\n\n');
        projectContext = [storeCtx, pipelineCtx].filter(Boolean).join('\n\n') || undefined;
    }

    // ── Stack detection ───────────────────────────────────────────────────────
    const detectedStack = detectProjectStack(cwd);
    if (detectedStack.length > 0) {
        const stackSection = `## Detected Project Stack\n${detectedStack.join(', ')}`;
        projectContext = projectContext ? `${projectContext}\n\n${stackSection}` : stackSection;
    }

    // ── Skills (3-layer: builtins in-memory + YAML lazy-loaded) ──────────────
    const builtinSkills: Skill[] = [
        ...GLOBAL_BUILTIN_SKILLS,
        ...NODE_PACK_SKILLS,
        ...GO_PACK_SKILLS,
        ...JAVA_PACK_SKILLS,
        ...KOTLIN_PACK_SKILLS,
        ...PYTHON_PACK_SKILLS,
    ];
    const skillLoader = opts.disablePersistence ? undefined : new SkillLoader(appName);
    const loadSkills = skillLoader
        ? async () => {
            const loaded = await skillLoader.loadAll(cwd);
            return [...loaded.global, ...loaded.packs, ...loaded.project];
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

    // ── Delegate engine assembly to createBaseEngine ──────────────────────────
    return createBaseEngine({
        providers,
        defaultProvider: opts.defaultProvider,
        agents: allAgents,
        tools: CODING_TOOLS,
        defaultAgent: opts.defaultAgent ?? 'general',
        transport: opts.transport,
        workingDir: cwd,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
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
        ...(opts.subAgentContextMessages ? { subAgentContextMessages: opts.subAgentContextMessages } : {}),
        ...(memorySystem ? { memorySystem } : {}),
        ...(historyPath ? { historyPath } : {}),
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
