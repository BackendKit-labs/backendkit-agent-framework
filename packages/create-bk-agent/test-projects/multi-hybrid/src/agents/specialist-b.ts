import type { AgentProfile } from '@backendkit-labs/agent-core';

// TODO: Rename and customize for your second specialist
export const SPECIALIST_B_PROFILE: AgentProfile = {
    id: 'specialist-b',
    name: 'Specialist B',
    icon: '📊',
    description: 'TODO: describe what this specialist does',
    delegatesTo: [],
    allowedTools: [
        'example_query', // TODO: list the tool names this agent can use
    ],
    systemPrompt: `You are a specialist in TODO: <your domain area>.

Use the available tools to complete the task delegated to you.`,
};
