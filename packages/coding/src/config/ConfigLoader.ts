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

const ENV_KEYS: Record<string, string> = {
    DEEPSEEK_API_KEY:  'deepseek',
    ANTHROPIC_API_KEY: 'anthropic',
    OPENAI_API_KEY:    'openai',
    KIMI_API_KEY:      'kimi',
    GROK_API_KEY:      'grok',
};

export class ConfigLoader {
    readonly configDir: string;
    readonly configPath: string;

    constructor(appName = 'bk-agent') {
        this.configDir  = join(homedir(), `.${appName}`);
        this.configPath = join(this.configDir, 'config.json');
    }

    load(): BkAgentConfig {
        mkdirSync(this.configDir, { recursive: true });

        let file: BkAgentConfig = {};
        if (existsSync(this.configPath)) {
            try { file = JSON.parse(readFileSync(this.configPath, 'utf-8')); }
            catch { console.warn(`[bk-agent] Could not parse ${this.configPath} — using defaults`); }
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

        // Auto-detect defaultProvider if not explicitly set
        if (!merged.defaultProvider) {
            const available = Object.entries(merged.providers ?? {})
                .filter(([, v]) => v?.apiKey)
                .map(([k]) => k);
            merged.defaultProvider = available[0];
        }

        return merged;
    }

    initTemplate(): void {
        mkdirSync(this.configDir, { recursive: true });
        if (!existsSync(this.configPath)) {
            const template: BkAgentConfig = {
                providers: {
                    deepseek: { apiKey: '', model: 'deepseek-chat' },
                },
                defaultProvider: 'deepseek',
            };
            writeFileSync(this.configPath, JSON.stringify(template, null, 2), 'utf-8');
            console.log(`[bk-agent] Created config template at ${this.configPath}`);
        }
    }
}
