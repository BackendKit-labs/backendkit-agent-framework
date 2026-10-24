import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_COMPLETION_TIMEOUT_MS, type CuratorLLMProvider, type CompleteOptions } from './types.js';

export interface AnthropicAdapterOptions {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    /** Per-request timeout in ms. Default: {@link DEFAULT_COMPLETION_TIMEOUT_MS}. */
    timeoutMs?: number;
}

export class AnthropicAdapter implements CuratorLLMProvider {
    private readonly client: Anthropic;
    private readonly model: string;
    private readonly maxTokens: number;

    constructor(opts: AnthropicAdapterOptions) {
        this.client    = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS });
        this.model     = opts.model     ?? 'claude-sonnet-4-6';
        this.maxTokens = opts.maxTokens ?? 16384;
    }

    async complete(systemPrompt: string, userMessage: string, opts: CompleteOptions = {}): Promise<string> {
        const json = opts.json !== false;
        const response = await this.client.messages.create({
            model:      this.model,
            max_tokens: this.maxTokens,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: userMessage }],
        });
        const block = response.content[0];
        return block?.type === 'text' ? block.text : (json ? '{}' : '');
    }
}
