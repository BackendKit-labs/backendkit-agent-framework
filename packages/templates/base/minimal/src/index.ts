import 'dotenv/config';
import { createBaseEngine } from '@backendkit-labs/agent-core';
import type { AgentProfile, LLMProvider } from '@backendkit-labs/agent-core';

// ── Provider ──────────────────────────────────────────────────────────────────
// TODO: replace with the actual provider for your chosen LLM
// e.g. AnthropicProvider from @backendkit-labs/agent-coding
// or implement LLMProvider interface directly

const myProvider: LLMProvider = {
    chat: async (_messages, _tools, callbacks) => {
        // TODO: call your LLM API here
        callbacks.onDone({ role: 'assistant', content: 'Hello from my agent!' });
    },
};

// ── Agent ─────────────────────────────────────────────────────────────────────

const myAgent: AgentProfile = {
    id: 'my-agent',
    name: 'My Agent',
    icon: '🤖',
    description: 'TODO: describe your agent',
    allowedTools: [],   // the tools this agent may call, by name; empty means none (a tool that is registered but not listed here is refused)
    delegatesTo: [],
    systemPrompt: 'TODO: write your system prompt here.',
};

// ── Engine ────────────────────────────────────────────────────────────────────

const engine = createBaseEngine({
    providers:       { default: myProvider },
    defaultProvider: 'default',
    agents:          [myAgent],
    defaultAgent:    'my-agent',
});

// ── Run ───────────────────────────────────────────────────────────────────────

void (async () => {
    const input = process.argv[2] ?? 'Hello';
    await engine.run(input);
})();
