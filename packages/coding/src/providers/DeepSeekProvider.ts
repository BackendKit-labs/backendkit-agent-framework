import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import type { OpenAICompatibleProviderOptions } from './OpenAICompatibleProvider';

export type DeepSeekProviderOptions = Omit<OpenAICompatibleProviderOptions, 'baseUrl' | 'model'> & {
    model?: string;
    baseUrl?: string;
};

/** Thin alias for OpenAICompatibleProvider pre-configured for DeepSeek */
export class DeepSeekProvider extends OpenAICompatibleProvider {
    constructor(opts: DeepSeekProviderOptions) {
        super({
            apiKey: opts.apiKey,
            baseUrl: opts.baseUrl ?? 'https://api.deepseek.com/v1',
            model: opts.model ?? 'deepseek-chat',
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
        });
    }
}
