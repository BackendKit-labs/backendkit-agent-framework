import type { AgentProfile } from '@backendkit-labs/agent-core';

export const MY_AGENT_PROFILE: AgentProfile = {
    id: 'my-agent',
    name: 'My Agent',
    icon: '🤖',
    description: 'TODO: describe what this agent does',
    delegatesTo: [],
    allowedTools: [
        'example_action',
        'example_query',
        // TODO: list the tool names this agent can use
    ],
    systemPrompt: `You are a helpful agent that TODO: <describe your domain>.

Use the available tools to complete tasks requested by the user.
Be precise and report results clearly.`,
};
