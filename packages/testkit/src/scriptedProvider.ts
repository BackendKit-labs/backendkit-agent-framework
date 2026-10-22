import type { LLMProvider } from '@backendkit-labs/agent-core';

/** One answer of a scripted provider: plain text, or a set of tool calls. */
export interface Turn {
    content?: string;
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    /** Reported through `onMetrics` when set, as a real provider does with `include_usage`. */
    metrics?: { inputTokens: number; outputTokens: number };
}

export interface ScriptedProviderOptions {
    /** What to answer once the script is used up. Default: the text `[script exhausted]`. */
    exhausted?: Turn;
}

/**
 * A provider that follows a fixed script: each `chat()` call consumes the next turn.
 * `provider.calls` records the messages every call received.
 */
export function scriptedProvider(turns: Turn[], options: ScriptedProviderOptions = {}): LLMProvider & { readonly calls: ReadonlyArray<Parameters<LLMProvider['chat']>[0]> } {
    let i = 0;
    const calls: Array<Parameters<LLMProvider['chat']>[0]> = [];
    return {
        calls,
        async chat(messages, _tools, callbacks) {
            calls.push(messages);
            const turn = turns[i++] ?? options.exhausted ?? { content: '[script exhausted]' };
            if (turn.metrics) callbacks.onMetrics?.(turn.metrics.inputTokens, turn.metrics.outputTokens);
            if (turn.tool_calls?.length) {
                for (const tc of turn.tool_calls) callbacks.onToolCall?.(tc.name, JSON.stringify(tc.args), tc.id);
                callbacks.onDone({
                    role: 'assistant',
                    content: null,
                    tool_calls: turn.tool_calls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                    })),
                });
                return;
            }
            const text = turn.content ?? '';
            callbacks.onChunk?.(text);
            callbacks.onDone({ role: 'assistant', content: text });
        },
    };
}
