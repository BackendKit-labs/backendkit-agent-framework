import prompts from 'prompts';

export type TemplateId = 'coding' | 'domain-agent' | 'autonomous' | 'mcp-server' | 'minimal';
export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'ollama';

export interface UserChoices {
    projectName: string;
    template: TemplateId;
    provider: ProviderId;
}

const TEMPLATES: Array<{ title: string; value: TemplateId; description: string }> = [
    { title: 'coding',       value: 'coding',       description: 'Coding assistant — edit files, run commands, search code' },
    { title: 'domain-agent', value: 'domain-agent', description: 'Multi-agent — orchestrator + domain specialists (e.g. docker, AWS)' },
    { title: 'autonomous',   value: 'autonomous',   description: 'Autonomous — activates on cron schedules, webhooks, events' },
    { title: 'mcp-server',   value: 'mcp-server',   description: 'MCP server — expose tools via Model Context Protocol' },
    { title: 'minimal',      value: 'minimal',      description: 'Minimal — bare engine, full control over everything' },
];

const PROVIDERS: Array<{ title: string; value: ProviderId; description: string }> = [
    { title: 'Anthropic (Claude)',         value: 'anthropic', description: 'claude-sonnet-4-6 recommended' },
    { title: 'OpenAI',                     value: 'openai',    description: 'gpt-4o recommended' },
    { title: 'DeepSeek / OpenAI-compatible', value: 'deepseek', description: 'deepseek-chat or any OpenAI-compatible endpoint' },
    { title: 'Ollama (local)',             value: 'ollama',    description: 'llama3.2, codellama, qwen2.5 — no API key needed' },
];

export async function askQuestions(defaultName: string): Promise<UserChoices | null> {
    const answers = await prompts(
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
                name: 'template',
                message: 'Template:',
                choices: TEMPLATES.map(t => ({
                    title: t.title.padEnd(14) + ' ' + t.description,
                    value: t.value,
                })),
                initial: 0,
            },
            {
                type: 'select',
                name: 'provider',
                message: 'LLM provider:',
                choices: PROVIDERS.map(p => ({
                    title: p.title.padEnd(30) + ' ' + p.description,
                    value: p.value,
                })),
                initial: 0,
            },
        ],
        { onCancel: () => { return false; } },
    );

    if (!answers.projectName || !answers.template || !answers.provider) return null;
    return answers as UserChoices;
}
