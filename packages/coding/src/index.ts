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

export { DeepSeekProvider } from './providers/DeepSeekProvider';
export { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
export { AnthropicProvider } from './providers/AnthropicProvider';
export { CODING_AGENTS } from './agents/profiles';
export * from './tools/read-file';
export * from './tools/write-file';
export * from './tools/edit-file';
export * from './tools/list-directory';
export * from './tools/run-command';
export * from './tools/search-files';

export const CODING_TOOLS = [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    runCommandTool,
    searchFilesTool,
];

// ─── Provider config types ────────────────────────────────────────────────────

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

/**
 * Map of provider configurations.
 * Built-in keys: deepseek | openai | anthropic | kimi | grok
 * Custom keys: any string you want, combined with a baseUrl in the config.
 */
export type ProvidersConfig = {
    deepseek?: OpenAICompatibleConfig;
    openai?: OpenAICompatibleConfig;
    anthropic?: AnthropicConfig;
    /** Kimi / Moonshot AI — OpenAI-compatible */
    kimi?: OpenAICompatibleConfig;
    /** xAI Grok — OpenAI-compatible */
    grok?: OpenAICompatibleConfig;
    [key: string]: OpenAICompatibleConfig | AnthropicConfig | undefined;
};

// ─── Known base URLs for OpenAI-compatible providers ─────────────────────────

const KNOWN_BASE_URLS: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
    kimi: 'https://api.moonshot.cn/v1',
    grok: 'https://api.x.ai/v1',
};

const DEFAULT_MODELS: Record<string, string> = {
    deepseek: 'deepseek-chat',
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    kimi: 'moonshot-v1-8k',
    grok: 'grok-3',
};

// ─── Engine options ───────────────────────────────────────────────────────────

export interface CodingEngineOptions {
    providers: ProvidersConfig;
    /** ID of the provider to use by default (must be a key in providers) */
    defaultProvider: string;
    defaultAgent?: string;
    workingDir?: string;
    maxIterations?: number;
    maxParallelAgents?: number;
    transport?: Transport;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

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
            if (!baseUrl) throw new Error(`Provider "${id}" requires a baseUrl (not a built-in provider)`);
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

    return new AgentEngine({
        model: { provider: opts.defaultProvider, id: opts.defaultProvider },
        agents,
        tools,
        providers,
        defaultProvider: opts.defaultProvider,
        transport: opts.transport ?? new StdoutTransport(),
        defaultAgentId: opts.defaultAgent ?? 'general',
        workingDir: opts.workingDir,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
    });
}
