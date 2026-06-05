import 'dotenv/config';

export interface Config {
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    // TODO: add your domain-specific config fields
}

export function loadConfig(): Config {
    const llmApiKey = process.env.LLM_API_KEY ?? '';
    if (!llmApiKey) throw new Error('Missing LLM_API_KEY in environment');

    return {
        llmApiKey,
        llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
        llmModel:   process.env.LLM_MODEL   ?? 'gpt-4o',
    };
}
