import prompts from 'prompts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ArchitectureId = 'multi-agent' | 'single' | 'coding' | 'autonomous' | 'minimal' | 'enterprise';
export type SkillPack      = 'node' | 'python' | 'go' | 'docker';
export type DeployMode     = 'repl' | 'mcp-http' | 'mcp-stdio' | 'hybrid' | 'library';
export type ProviderId     = 'anthropic' | 'openai' | 'deepseek' | 'ollama';

export interface UserChoices {
    projectName:  string;
    architecture: ArchitectureId;
    skillPacks:   SkillPack[];
    deployMode:   DeployMode | undefined;
    provider:     ProviderId;
    /** Absolute path to Obsidian vault — only set when architecture === 'enterprise' */
    vaultPath?:   string;
}

// ── Option definitions ────────────────────────────────────────────────────────

const p = (s: string, n: number) => s.padEnd(n);

const ARCHITECTURE_CHOICES = [
    {
        title: p('Multi-agent', 22) + 'Orchestrator delegates to specialized sub-agents',
        value: 'multi-agent' as ArchitectureId,
        description: 'Best for complex domains (git: commit / branch / merge / recovery)',
    },
    {
        title: p('Single agent', 22) + 'One agent handles all requests with tools',
        value: 'single' as ArchitectureId,
        description: 'Best for focused single-domain tasks and quick prototypes',
    },
    {
        title: p('Coding assistant', 22) + '10 pre-built agents for software dev — ready to run',
        value: 'coding' as ArchitectureId,
        description: 'Just add your API key and run',
    },
    {
        title: p('Autonomous daemon', 22) + 'Cron / webhook triggers, no human input',
        value: 'autonomous' as ArchitectureId,
        description: 'Best for background monitoring, alerts, automated reports',
    },
    {
        title: p('Minimal / embedded', 22) + 'Bare engine factory, full control',
        value: 'minimal' as ArchitectureId,
        description: 'Best for embedding in an existing app or custom architecture',
    },
    {
        title: p('Enterprise', 22) + 'Local LLM + Obsidian knowledge base — no cloud needed',
        value: 'enterprise' as ArchitectureId,
        description: 'Business agent with RAG over your company docs, runs 100% on-premise',
    },
];

const SKILL_PACK_CHOICES = [
    { title: p('Node.js / TypeScript', 24) + 'npm, jest, tsc, eslint',   value: 'node'   as SkillPack },
    { title: p('Python', 24)               + 'pytest, ruff, mypy, pip',  value: 'python' as SkillPack },
    { title: p('Go', 24)                   + 'go test, golangci-lint',    value: 'go'     as SkillPack },
    { title: p('Docker / K8s', 24)         + 'docker, kubectl, helm',     value: 'docker' as SkillPack },
];

const DEPLOY_MODE_CHOICES = [
    {
        title: p('Terminal REPL', 28) + 'Humans type requests, agent responds in the terminal',
        value: 'repl' as DeployMode,
    },
    {
        title: p('MCP Server — HTTP', 28) + 'Other agents / tools connect via HTTP protocol',
        value: 'mcp-http' as DeployMode,
        description: 'e.g. git-agent server that another bk-agent connects to',
    },
    {
        title: p('MCP Server — stdio', 28) + 'Claude Desktop / Cursor / VS Code integration',
        value: 'mcp-stdio' as DeployMode,
    },
    {
        title: p('REPL + MCP Server', 28) + 'Hybrid — humans use it AND other agents connect',
        value: 'hybrid' as DeployMode,
    },
    {
        title: p('Library only', 28) + 'No entry point — imported programmatically',
        value: 'library' as DeployMode,
    },
];

const PROVIDER_CHOICES = [
    { title: p('Anthropic (Claude)', 32)          + 'claude-sonnet-4-6 recommended',               value: 'anthropic' as ProviderId },
    { title: p('OpenAI', 32)                       + 'gpt-4o recommended',                          value: 'openai'    as ProviderId },
    { title: p('DeepSeek / OpenAI-compatible', 32) + 'deepseek-chat or any OpenAI-compatible endpoint', value: 'deepseek' as ProviderId },
    { title: p('Ollama (local)', 32)               + 'llama3.2, codellama — no API key needed',     value: 'ollama'    as ProviderId },
];

// ── Conditional question helpers ──────────────────────────────────────────────

const NEEDS_SKILLS: ArchitectureId[] = ['multi-agent', 'single'];
const NEEDS_DEPLOY: ArchitectureId[] = ['multi-agent', 'single', 'coding', 'enterprise'];

// @types/prompts doesn't fully type the function form of `type` — cast at call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whenSkills = (_prev: any, v: Record<string, any>) =>
    NEEDS_SKILLS.includes(v.architecture) ? 'multiselect' : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whenDeploy = (_prev: any, v: Record<string, any>) =>
    NEEDS_DEPLOY.includes(v.architecture) ? 'select' : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whenVault = (_prev: any, v: Record<string, any>) =>
    v.architecture === 'enterprise' ? 'text' : null;

// ── Main question flow ────────────────────────────────────────────────────────

export async function askQuestions(defaultName: string): Promise<UserChoices | null> {
    const raw = await prompts(
        [
            {
                type: 'text',
                name: 'projectName',
                message: 'Project name:',
                initial: defaultName,
                validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
            },
            {
                type: 'select',
                name: 'architecture',
                message: 'What type of agent are you building?',
                choices: ARCHITECTURE_CHOICES,
                initial: 0,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
                type: whenSkills as any,
                name: 'skillPacks',
                message: 'Include skill packs?  (space to toggle, enter to confirm)',
                choices: SKILL_PACK_CHOICES,
                instructions: false,
                hint: 'Adds domain-specific instructions to your agents. Can be skipped.',
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
                type: whenDeploy as any,
                name: 'deployMode',
                message: 'How will this agent be used?',
                choices: DEPLOY_MODE_CHOICES,
                initial: 0,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
                type: whenVault as any,
                name: 'vaultPath',
                message: 'Obsidian vault path (absolute):',
                initial: '',
                validate: (v: string) =>
                    v.trim().length > 0 || 'Vault path is required for enterprise agents',
            },
            {
                type: 'select',
                name: 'provider',
                message: 'LLM provider:',
                choices: PROVIDER_CHOICES,
                initial: 0,
            },
        ],
        { onCancel: () => false },
    );

    if (!raw.projectName || !raw.architecture || !raw.provider) return null;

    return {
        projectName:  raw.projectName  as string,
        architecture: raw.architecture as ArchitectureId,
        skillPacks:   (raw.skillPacks  ?? []) as SkillPack[],
        deployMode:   (raw.deployMode  ?? undefined) as DeployMode | undefined,
        provider:     raw.provider     as ProviderId,
        vaultPath:    (raw.vaultPath   ?? undefined) as string | undefined,
    };
}
