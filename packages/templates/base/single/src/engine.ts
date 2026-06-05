import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
} from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { loadConfig } from './config';
import { MY_AGENT_PROFILE } from './agents/my-agent';
import { exampleAction, exampleQuery } from './tools/example-tools';

export function createEngine(transport: CallbackTransport): AgentEngine {
    const config = loadConfig();

    const tools = new ToolRegistry();
    tools
        .register(exampleAction)
        .register(exampleQuery);
    // TODO: register more tools

    const agents = new AgentRegistry();
    agents.register(MY_AGENT_PROFILE);
    // TODO: register more specialists

    const providers = new ProviderRegistry();
    providers.register('default', new OpenAICompatibleProvider({
        apiKey:  config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model:   config.llmModel,
    }));

    return new AgentEngine({
        model:           { provider: 'default', id: config.llmModel },
        agents,
        tools,
        providers,
        defaultProvider:  'default',
        defaultAgentId:   'my-agent',
        transport,
        maxIterations:    20,
        iterationMode:    'auto',
    });
}
