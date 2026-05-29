import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    AgentEngine,
    AgentRegistry,
    ProviderRegistry,
    ToolRegistry,
    SkillLoader,
    GLOBAL_BUILTIN_SKILLS,
    NODE_PACK_SKILLS,
    type Transport,
    type Skill,
    StdoutTransport,
    getProjectDir,
} from '@bk/agent-core';
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
    { file: 'package.json',     stack: 'node' },
    { file: 'tsconfig.json',    stack: 'typescript' },
    { file: 'requirements.txt', stack: 'python' },
    { file: 'pyproject.toml',   stack: 'python' },
    { file: 'pom.xml',          stack: 'java' },
    { file: 'build.gradle',     stack: 'java' },
    { file: 'Cargo.toml',       stack: 'rust' },
    { file: 'go.mod',           stack: 'go' },
    { file: 'composer.json',    stack: 'php' },
    { file: 'Gemfile',          stack: 'ruby' },
    { file: 'mix.exs',          stack: 'elixir' },
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
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCodingEngine(opts: CodingEngineOptions): AgentEngine {
    const cwd     = opts.workingDir ?? process.cwd();
    const appName = opts.appName ?? 'bk-agent';

    const agents = new AgentRegistry();
    const allAgents = AgentLoader.load({ appName, cwd, builtins: CODING_AGENTS });
    for (const a of allAgents) agents.upsert(a);

    const tools = new ToolRegistry();
    for (const tool of CODING_TOOLS) tools.register(tool);

    const providers = new ProviderRegistry();
    for (const [id, config] of Object.entries(opts.providers)) {
        if (!config) continue;
        if (id === 'anthropic') {
            const cfg = config as AnthropicConfig;
            providers.register(id, new AnthropicProvider({
                apiKey: cfg.apiKey,
                model: cfg.model ?? DEFAULT_MODELS.anthropic,
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
            }));
        } else {
            const cfg = config as OpenAICompatibleConfig;
            const baseUrl = cfg.baseUrl ?? KNOWN_BASE_URLS[id];
            if (!baseUrl) throw new Error(`Provider "${id}" requires a baseUrl`);
            providers.register(id, new OpenAICompatibleProvider({
                apiKey: cfg.apiKey,
                baseUrl,
                model: cfg.model ?? DEFAULT_MODELS[id] ?? 'gpt-4o',
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
            }));
        }
    }

    if (!providers.has(opts.defaultProvider)) {
        throw new Error(`defaultProvider "${opts.defaultProvider}" is not configured in providers`);
    }

    // ── Persistent store + memory ─────────────────────────────────────────────
    let store: ProjectStore | undefined;
    let memory: PersistentMemory | undefined;
    let projectContext: string | undefined;

    if (!opts.disablePersistence) {
        store = new ProjectStore(cwd, appName);
        memory = new PersistentMemory(store.projectDir);

        // Load AGENT.md from working directory if present
        const agentMdPath = join(cwd, 'AGENT.md');
        const agentMd = existsSync(agentMdPath)
            ? readFileSync(agentMdPath, 'utf-8').trim()
            : undefined;

        // Extra pipeline files managed by other subsystems (not ProjectStore)
        const projectDir = getProjectDir(appName, cwd);
        const pipelineParts: string[] = [];
        const tryRead = (path: string) => existsSync(path) ? readFileSync(path, 'utf-8').trim() : null;

        const sesion = tryRead(join(projectDir, 'memory', 'session.md'));
        if (sesion) pipelineParts.push(`## Current Session\n${sesion}`);

        const lecciones = tryRead(join(projectDir, 'audits', 'lecciones-aprendidas.md'));
        if (lecciones) pipelineParts.push(`## Lecciones Aprendidas\n${lecciones}`);

        // buildSystemContext already covers: USER.md, AGENT.md, memory/contexto-proyecto.md,
        // learnings.md, log.md — so we only add what it doesn't manage
        const storeCtx = store.buildSystemContext(agentMd) || '';
        const pipelineCtx = pipelineParts.join('\n\n');
        projectContext = [storeCtx, pipelineCtx].filter(Boolean).join('\n\n') || undefined;
    }

    // Detect the project stack from indicator files and append to context.
    // Acts as a fallback when AGENT.md hasn't been generated yet (no init workflow run).
    const detectedStack = detectProjectStack(cwd);
    if (detectedStack.length > 0) {
        const stackSection = `## Detected Project Stack\n${detectedStack.join(', ')}`;
        projectContext = projectContext ? `${projectContext}\n\n${stackSection}` : stackSection;
    }

    // ── Skills ────────────────────────────────────────────────────────────────
    // Start with the in-memory builtins (global + node pack).
    // YAML skills (user global, installed packs, project-specific) are loaded
    // lazily on the first engine.run() call to keep createCodingEngine() sync.
    const builtinSkills: Skill[] = [...GLOBAL_BUILTIN_SKILLS, ...NODE_PACK_SKILLS];
    const skillLoader = opts.disablePersistence ? undefined : new SkillLoader(appName);
    const loadSkills = skillLoader
        ? async () => {
            const loaded = await skillLoader.loadAll(cwd);
            return [...loaded.global, ...loaded.packs, ...loaded.project];
        }
        : undefined;

    return new AgentEngine({
        model: { provider: opts.defaultProvider, id: opts.defaultProvider },
        agents,
        tools,
        providers,
        defaultProvider: opts.defaultProvider,
        transport: opts.transport ?? new StdoutTransport(),
        defaultAgentId: opts.defaultAgent ?? 'general',
        workingDir: cwd,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
        store,
        projectContext,
        skills: builtinSkills,
        detectedStack,
        loadSkills,
        ...(memory ? { sessionMemory: memory } : {}),
    });
}

// ── Config-based factory (reads ~/.bk-agent/config.json) ─────────────────────

export function createCodingEngineFromConfig(overrides: Partial<CodingEngineOptions> = {}): AgentEngine {
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
        ...overrides,
        appName,
    });
}
