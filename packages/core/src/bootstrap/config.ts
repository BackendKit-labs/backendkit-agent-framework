import * as fs from 'fs/promises';
import * as path from 'path';
import { getFrameworkDir } from '../shared/utils/project-key';

// ── Framework config shape ────────────────────────────────────────────────────

export interface ProviderConfig {
    model: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface FrameworkFeatures {
    qa: boolean;
    orchestration: boolean;
    reflection: boolean;
    delegation: boolean;
}

export interface FrameworkConfig {
    version: string;
    defaultProvider: string;
    defaultModel: string;
    defaultAgentId: string;
    maxIterations: number;
    maxParallelAgents: number;
    providers: Record<string, ProviderConfig>;
    features: FrameworkFeatures;
}

export const DEFAULT_CONFIG: FrameworkConfig = {
    version: '2.0.0',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    defaultAgentId: 'general',
    maxIterations: 100,
    maxParallelAgents: 6,
    providers: {
        anthropic: { model: 'claude-sonnet-4-6' },
        openai:    { model: 'gpt-4o' },
        deepseek:  { model: 'deepseek-chat' },
    },
    features: {
        qa:             true,
        orchestration:  true,
        reflection:     true,
        delegation:     true,
    },
};

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadFrameworkConfig(appName: string): Promise<FrameworkConfig> {
    const configPath = path.join(getFrameworkDir(appName), 'config.json');
    try {
        const raw = await fs.readFile(configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as FrameworkConfig;
    } catch {
        return DEFAULT_CONFIG;
    }
}
