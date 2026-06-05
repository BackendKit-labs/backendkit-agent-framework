import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { z } from 'zod';
import { createEngine } from './engine';

const server = new AgentMCPServer({
    name:    process.env.npm_package_name ?? 'my-agent',
    version: '1.0.0',

    tools: [
        {
            name:        'agent_request',
            description: 'TODO: describe what requests this agent handles',
            schema: {
                request: z.string().describe('Natural-language request for the agent'),
            },
            buildPrompt: ({ request }: { request: string }) => request,
        },
    ],

    engineFactory: (transport: CallbackTransport) => createEngine(transport),
});

await server.startStdio();
