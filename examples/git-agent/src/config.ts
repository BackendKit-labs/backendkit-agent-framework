import 'dotenv/config';

export type StructuredOutputMode = 'native' | 'json_object' | 'none';

export interface Config {
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    /** Reasoning toggle for models that support it (e.g. DeepSeek V4). Unset = the API default. */
    thinking?: 'enabled' | 'disabled';
    /** How the backend enforces `engine.generateObject` schemas. */
    structuredOutput: StructuredOutputMode;
    /** Register only the read-only git tools: the agents can inspect but never change the repo. */
    readOnly: boolean;
    /** Spending cap per run, in USD. Needs the two prices below to mean anything. */
    budgetUsd?: number;
    /** USD per million tokens. Approximate numbers are fine; they only drive cost display and the cap. */
    priceInPerM?: number;
    priceOutPerM?: number;
}

function numberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
    return n;
}

function oneOf<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
    return raw as T;
}

export function loadConfig(): Config {
    const llmApiKey = process.env.LLM_API_KEY ?? '';
    if (!llmApiKey) throw new Error('Missing LLM_API_KEY in environment');

    const llmBaseUrl = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';

    return {
        llmApiKey,
        llmBaseUrl,
        llmModel:   process.env.LLM_MODEL ?? 'gpt-4o',
        thinking:   oneOf('LLM_THINKING', ['enabled', 'disabled'] as const),
        // DeepSeek has no json_schema: its JSON mode takes the schema in the prompt.
        structuredOutput: oneOf('LLM_STRUCTURED_OUTPUT', ['native', 'json_object', 'none'] as const)
            ?? (llmBaseUrl.includes('deepseek') ? 'json_object' : 'native'),
        readOnly:     process.env.GIT_AGENT_READONLY === '1',
        budgetUsd:    numberEnv('GIT_AGENT_BUDGET_USD'),
        priceInPerM:  numberEnv('LLM_PRICE_IN_PER_M'),
        priceOutPerM: numberEnv('LLM_PRICE_OUT_PER_M'),
    };
}
