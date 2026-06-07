import type { AgentProfile } from '@backendkit-labs/agent-core';

// The orchestrator receives every user request and delegates to the right specialist.
// It does NOT call tools directly — it uses ask_agent to route work.
export const ORCHESTRATOR_PROFILE: AgentProfile = {
    id: 'orchestrator',
    name: 'Orchestrator',
    icon: '🎯',
    description: 'Routes requests to the right specialist agent',
    delegatesTo: ['specialist-a', 'specialist-b'], // TODO: list your specialists
    allowedTools: [],
    systemPrompt: `You are the orchestrator for a TODO: <describe your domain> system.

Your ONLY job is to analyze the user request and delegate to the right specialist via ask_agent.
Do not attempt to handle requests directly.

Available specialists:
- specialist-a: TODO describe what this specialist handles
- specialist-b: TODO describe what this specialist handles

Always delegate. Never answer directly.`,
};
