import type { LLMProvider, LLMMessage } from '../types';
import type { LLMChatClient } from './intent-detector';

/**
 * Adapts a streaming LLMProvider to the simpler LLMChatClient interface
 * required by Orchestrator (intent detection) and QAService (inline review).
 *
 * Accumulates the streaming response into a single string so the
 * Orchestrator and QAService can work with synchronous-style completions.
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
