import type { ChatOptions, LLMProvider, LLMMessage } from '../../types';

/** The smallest chat interface: one request, one text answer. Verticals use it for classification and review calls. */
export interface LLMChatClient {
    chat(messages: Array<{ role: string; content: string }>, tools?: unknown, temperature?: number, options?: ChatOptions): Promise<{ content: string | null }>;
}

/**
 * Adapts a streaming LLMProvider to the simpler LLMChatClient interface: accumulates the streamed
 * response into a single string.
 */
export function adaptProviderToLLMClient(provider: LLMProvider): LLMChatClient {
    return {
        async chat(messages, _tools, _temperature, options) {
            let accumulated = '';
            let failure: Error | undefined;

            await provider.chat(
                messages.map(m => ({
                    role: m.role as LLMMessage['role'],
                    content: m.content,
                })),
                [],
                {
                    onChunk: (delta) => { accumulated += delta; },
                    onDone: () => { /* stream finished */ },
                    onError: (err) => { failure = err; },
                },
                options,
            );

            if (failure) throw failure;
            return { content: accumulated || null };
        },
    };
}
