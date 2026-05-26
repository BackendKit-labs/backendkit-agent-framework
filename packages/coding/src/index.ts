import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    AgentEngine,
    AgentRegistry,
    ProviderRegistry,
    ToolRegistry,
    type Transport,
    StdoutTransport,
} from '@bk/agent-core';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { CODING_AGENTS } from './agents/profiles';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';
import { listDirectoryTool } from './tools/list-directory';
import { runCommandTool } from './tools/run-command';
import { searchFilesTool } from './tools/search-files';
import { saveContextTool } from './tools/save-context';
import { saveLearningTool } from './tools/save-learning';
import { saveAuditTool, getLatestAuditTool, listAuditsTool } from './tools/save-audit';
import { appendLogTool } from './tools/append-log';
import { saveUserPreferenceTool } from './tools/save-user-preference';
import { ProjectStore } from './store/ProjectStore';
import { PersistentMemory } from './store/PersistentMemory';
import { ConfigLoader } from './config/ConfigLoader';

// ── Re-exports ────────────────────────────────────────────────────────────────
export { DeepSeekProvider } from './providers/DeepSeekProvider';
export { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
export { AnthropicProvider } from './providers/AnthropicProvider';
export { CODING_AGENTS } from './agents/profiles';
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
export * from './tools/append-log';
export * from './tools/save-user-preference';

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
    appendLogTool,
    saveUserPreferenceTool,
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
    /** Skip creating a ProjectStore (e.g. for testing) */
    disablePersistence?: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCodingEngine(opts: CodingEngineOptions): AgentEngine {
    const agents = new AgentRegistry();
    agents.registerAll(CODING_AGENTS);

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
    const cwd = opts.workingDir ?? process.cwd();
    let store: ProjectStore | undefined;
    let memory: PersistentMemory | undefined;
    let projectContext: string | undefined;

    if (!opts.disablePersistence) {
        store = new ProjectStore(cwd);
        memory = new PersistentMemory(store.projectDir);

        // Load AGENT.md from working directory if present
        const agentMdPath = join(cwd, 'AGENT.md');
        const agentMd = existsSync(agentMdPath)
            ? readFileSync(agentMdPath, 'utf-8').trim()
            : undefined;

        projectContext = store.buildSystemContext(agentMd) || undefined;
    }

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
        ...(memory ? { sessionMemory: memory } : {}),
    });
}

// ── Config-based factory (reads ~/.bk-agent/config.json) ─────────────────────

export function createCodingEngineFromConfig(overrides: Partial<CodingEngineOptions> = {}): AgentEngine {
    const config = ConfigLoader.load();

    if (!config.defaultProvider) {
        throw new Error(
            'No provider configured. Set DEEPSEEK_API_KEY or add providers to ~/.bk-agent/config.json'
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
    });
}
