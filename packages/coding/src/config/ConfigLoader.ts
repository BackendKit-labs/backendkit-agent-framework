import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ProviderFileConfig {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}

export interface BkAgentConfig {
    providers?: Record<string, ProviderFileConfig>;
    defaultProvider?: string;
    agents?: Record<string, { provider?: string }>;
}

const CONFIG_DIR  = join(homedir(), '.bk-agent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const ENV_KEYS: Record<string, string> = {
    DEEPSEEK_API_KEY:  'deepseek',
    ANTHROPIC_API_KEY: 'anthropic',
    OPENAI_API_KEY:    'openai',
    KIMI_API_KEY:      'kimi',
    GROK_API_KEY:      'grok',
};

export class ConfigLoader {
    static readonly configPath = CONFIG_FILE;
    static readonly configDir  = CONFIG_DIR;

    static load(): BkAgentConfig {
        mkdirSync(CONFIG_DIR, { recursive: true });

        let file: BkAgentConfig = {};
        if (existsSync(CONFIG_FILE)) {
            try { file = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); }
            catch { console.warn(`[bk-agent] Could not parse ${CONFIG_FILE} — using defaults`); }
        }

        const merged: BkAgentConfig = {
            ...file,
            providers: { ...file.providers },
        };

        // Env vars override file values
        for (const [envKey, providerId] of Object.entries(ENV_KEYS)) {
            const apiKey = process.env[envKey];
            if (apiKey) {
                merged.providers![providerId] = {
                    ...merged.providers![providerId],
                    apiKey,
                };
            }
        }

        if (process.env.AGENT_PROVIDER) {
            merged.defaultProvider = process.env.AGENT_PROVIDER;
        }

        // Auto-detect defaultProvider if not set
        if (!merged.defaultProvider) {
            const available = Object.entries(merged.providers ?? {})
                .filter(([, v]) => v?.apiKey)
                .map(([k]) => k);
            merged.defaultProvider = available[0];
        }

        return merged;
    }

    static initTemplate(): void {
        mkdirSync(CONFIG_DIR, { recursive: true });
        if (!existsSync(CONFIG_FILE)) {
            const template: BkAgentConfig = {
                providers: {
                    deepseek: { apiKey: '', model: 'deepseek-chat' },
                },
                defaultProvider: 'deepseek',
            };
            writeFileSync(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf-8');
            console.log(`[bk-agent] Created config template at ${CONFIG_FILE}`);
        }
    }
}
