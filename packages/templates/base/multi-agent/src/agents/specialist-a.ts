import type { AgentProfile } from '@backendkit-labs/agent-core';

// TODO: Rename this file and agent to match your domain (e.g. docker-agent.ts, k8s-agent.ts)
export const SPECIALIST_A_PROFILE: AgentProfile = {
    id: 'specialist-a',
    name: 'Specialist A',
    icon: '🔧',
    description: 'TODO: describe what this specialist does',
    delegatesTo: [],
    allowedTools: [
        'example_action', // TODO: list the tool names this agent can use
    ],
    systemPrompt: `You are a specialist in TODO: <your domain area>.

Use the available tools to complete the task delegated to you.
Be precise and report results clearly.`,
};
