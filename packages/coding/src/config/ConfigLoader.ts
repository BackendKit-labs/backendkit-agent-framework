import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MCPServerConfig } from '@bk/agent-core';

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
    mcpServers?: MCPServerConfig[];
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

const AGENTS_README = `# Global Agents

Drop custom agent definitions here. Each agent needs two files:

  {id}.json   — profile (required)
  {id}.md     — system prompt (optional, overrides the default)

These agents are available in ALL projects (+) and override built-in agents
with the same id. Project-level agents (.{appName}/agents/) take priority over these.

## Example: my-reviewer.json

\`\`\`json
{
  "id": "my-reviewer",
  "name": "My Reviewer",
  "icon": "◎",
  "description": "Code review focused on our team conventions",
  "provider": "anthropic",
  "delegatesTo": ["coder"]
}
\`\`\`

## Example: my-reviewer.md

\`\`\`
You are a code reviewer who enforces our team conventions:
- No console.log in production code
- All public functions must have JSDoc
- Prefer early returns over nested ifs
\`\`\`

## Built-in agents (already included, override by creating same id here)

  general       Orchestrator — delegates to specialists
  coder         Pure implementation — writes files, runs commands
  backend       APIs, controllers, services, ORMs
  frontend      React, Vue, components, CSS
  qa-engineer   Unit, integration and e2e tests
  security      OWASP, vulnerabilities, auth hardening
  architecture  System design, DDD, microservices
  infrastructure Docker, Kubernetes, CI/CD
  data          SQL, indexes, ETL, pipelines
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
            // Fix #5: warn when config.json is readable by group or others
            if (process.platform !== 'win32') {
                const mode = statSync(this.configPath).mode & 0o777;
                if (mode & 0o044) {
                    console.warn(
                        `[config] ⚠ ${this.configPath} has permissions ${mode.toString(8).padStart(3, '0')} — ` +
                        `API keys are readable by others. Fix with: chmod 600 ${this.configPath}`,
                    );
                }
            }
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
            // Fix #5: restrict config.json (contains API keys) to owner-only on POSIX
            if (process.platform !== 'win32') {
                chmodSync(this.configPath, 0o600);
            }
        }

        const userMdPath = join(this.configDir, 'USER.md');
        if (!existsSync(userMdPath)) {
            writeFileSync(userMdPath, USER_MD_TEMPLATE, 'utf-8');
        }

        const agentsReadme = join(this.agentsDir, 'README.md');
        if (!existsSync(agentsReadme)) {
            writeFileSync(agentsReadme, AGENTS_README, 'utf-8');
        }

        if (isNew) {
            console.log(`\x1b[90m  bootstrapped ${this.configDir}\x1b[0m`);
        }
    }

    initTemplate(): void {
        this._bootstrap();
    }
}
