import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';

export interface DeepSeekProviderOptions {
    apiKey: string;
    model?: string;
    /** Total attempts on transient errors (429, 5xx, network), first try included. Default: 3. */
    maxRetries?: number;
    /** Override the base URL. Defaults to DeepSeek API. Use http://localhost:11434/v1 for Ollama. */
    baseUrl?: string;
    /** Temperature. Reasoning models (deepseek-reasoner) require 1. Default: 0 for chat, 1 for reasoner. */
    temperature?: number;
}

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL     = 'deepseek-chat';

/**
 * Thin adapter over the shared `@backendkit-labs/agent-providers` implementation. It keeps this
 * example's defaults (model, base URL, temperature rule for reasoning models, no `max_tokens`) and
 * gains what the shared provider adds: retries on network errors, abort support, per-call model
 * override and usage reporting.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
    constructor(opts: DeepSeekProviderOptions) {
        super({
            apiKey:  opts.apiKey,
            baseUrl: opts.baseUrl ?? DEEPSEEK_BASE_URL,
            model:   opts.model ?? DEFAULT_MODEL,
            maxAttempts: opts.maxRetries ?? 3,
            maxTokens: null, // the old copy never sent max_tokens: leave it to the API default
            temperature: opts.temperature ?? ((model) => (model.includes('reasoner') ? 1 : 0)),
            // DeepSeek (and Ollama through baseUrl) only offer JSON mode, not json_schema.
            structuredOutput: 'json_object',
        });
    }
}
