import type { Transport } from '../transport/Transport';
import type { AgentEvent, LLMProvider, AgentProfile } from '../types';
import { AgentRegistry } from '../engine/AgentRegistry';
import { ToolRegistry } from '../engine/ToolRegistry';
import { ProviderRegistry } from '../engine/ProviderRegistry';

// ── Transport ─────────────────────────────────────────────────────────────────

export function createMockTransport(): { transport: Transport; events: AgentEvent[] } {
    const events: AgentEvent[] = [];
    const transport: Transport = {
        emit: (event) => { events.push(event); },
        onInput: () => () => undefined,
        close: () => undefined,
    };
    return { transport, events };
}

// ── LLM providers ─────────────────────────────────────────────────────────────

/** Provider that emits a plain text response. */
export function createTextProvider(text: string): LLMProvider {
    return {
        async chat(_messages, _tools, callbacks) {
            callbacks.onChunk?.(text);
            callbacks.onDone({ role: 'assistant', content: text });
        },
    };
}

/** Provider that calls a tool on the first invocation, then responds with text. */
export function createToolCallProvider(
    toolName: string,
    args: Record<string, unknown>,
    followupText: string,
): LLMProvider {
    let firstCall = true;
    return {
        async chat(_messages, _tools, callbacks) {
            if (firstCall) {
                firstCall = false;
                const id = 'call_1';
                callbacks.onToolCall?.(toolName, JSON.stringify(args), id);
                callbacks.onDone({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
                });
            } else {
                callbacks.onChunk?.(followupText);
                callbacks.onDone({ role: 'assistant', content: followupText });
            }
        },
    };
}

/** Provider that always throws. */
export function createFailingProvider(message = 'LLM error'): LLMProvider {
    return {
        async chat(_messages, _tools, callbacks) {
            callbacks.onError(new Error(message));
        },
    };
}

// ── Agent profile ─────────────────────────────────────────────────────────────

export const testAgent: AgentProfile = {
    id: 'test-agent',
    name: 'Test Agent',
    icon: '🤖',
    description: 'A simple test agent',
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    delegatesTo: [],
};

// ── Engine builder ────────────────────────────────────────────────────────────

export function buildRegistries(provider: LLMProvider, agent = testAgent) {
    const agents = new AgentRegistry();
    agents.upsert(agent);
    const tools = new ToolRegistry();
    const providers = new ProviderRegistry();
    providers.register('mock', provider);
    return { agents, tools, providers };
}
