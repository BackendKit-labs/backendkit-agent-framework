import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './OpenAICompatibleProvider';

export type DeepSeekProviderOptions = Omit<OpenAICompatibleProviderOptions, 'baseUrl' | 'model'> & {
    model?: string;
    baseUrl?: string;
};

/** OpenAICompatibleProvider pre-configured for DeepSeek. */
export class DeepSeekProvider extends OpenAICompatibleProvider {
    constructor(opts: DeepSeekProviderOptions) {
        super({
            ...opts,
            baseUrl: opts.baseUrl ?? 'https://api.deepseek.com/v1',
            model: opts.model ?? 'deepseek-v4-flash',
        });
    }
}
