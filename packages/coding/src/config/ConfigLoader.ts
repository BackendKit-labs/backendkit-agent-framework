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

const CONFIG_TEMPLATE = `{
  "providers": {
    "deepseek": { "apiKey": "", "model": "deepseek-chat" },
    "anthropic": { "apiKey": "", "model": "claude-sonnet-4-6" },
    "openai":    { "apiKey": "", "model": "gpt-4o" }
  },
  "defaultProvider": "deepseek"
}
`;

const USER_MD_TEMPLATE = `# User Profile

Add personal context here — your role, preferences, working style.
The agent will read this to tailor its responses to you.

## Role
<!-- e.g. Senior backend engineer, mostly NestJS and Go -->

## Preferences
<!-- e.g. Prefer concise answers, Spanish responses -->
`;

export class ConfigLoader {
    readonly configDir: string;
    readonly configPath: string;
    readonly agentsDir: string;

    constructor(appName = 'bk-agent') {
        this.configDir  = join(homedir(), `.${appName}`);
        this.configPath = join(this.configDir, 'config.json');
        this.agentsDir  = join(this.configDir, 'agents');
    }

    load(): BkAgentConfig {
        this._bootstrap();

        let file: BkAgentConfig = {};
        if (existsSync(this.configPath)) {
            try { file = JSON.parse(readFileSync(this.configPath, 'utf-8')); }
            catch { console.warn(`[config] Could not parse ${this.configPath} — using defaults`); }
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

    private _bootstrap(): void {
        const isNew = !existsSync(this.configDir);

        mkdirSync(this.configDir,  { recursive: true });
        mkdirSync(this.agentsDir,  { recursive: true });
        mkdirSync(join(this.configDir, 'projects'), { recursive: true });

        if (!existsSync(this.configPath)) {
            writeFileSync(this.configPath, CONFIG_TEMPLATE, 'utf-8');
        }

        const userMdPath = join(this.configDir, 'USER.md');
        if (!existsSync(userMdPath)) {
            writeFileSync(userMdPath, USER_MD_TEMPLATE, 'utf-8');
        }

        if (isNew) {
            console.log(`\x1b[90m  bootstrapped ${this.configDir}\x1b[0m`);
        }
    }

    initTemplate(): void {
        this._bootstrap();
    }
}
