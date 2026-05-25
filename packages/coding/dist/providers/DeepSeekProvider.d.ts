import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@bk/agent-core';
export interface DeepSeekProviderOptions {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}
export declare class DeepSeekProvider implements LLMProvider {
    private readonly client;
    private readonly model;
    private readonly maxTokens;
    private readonly temperature;
    constructor(opts: DeepSeekProviderOptions);
    chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void>;
}
//# sourceMappingURL=DeepSeekProvider.d.ts.map