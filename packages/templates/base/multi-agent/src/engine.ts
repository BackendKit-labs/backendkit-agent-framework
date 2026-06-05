import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
} from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { loadConfig } from './config';
import { ORCHESTRATOR_PROFILE } from './agents/orchestrator';
import { SPECIALIST_A_PROFILE } from './agents/specialist-a';
import { SPECIALIST_B_PROFILE } from './agents/specialist-b';
import { exampleAction, exampleQuery } from './tools/example-tools';

export function createEngine(transport: CallbackTransport): AgentEngine {
    const config = loadConfig();

    const tools = new ToolRegistry();
    tools
        .register(exampleAction)
        .register(exampleQuery);
    // TODO: register more tools

    const agents = new AgentRegistry();
    agents
        .register(ORCHESTRATOR_PROFILE)
        .register(SPECIALIST_A_PROFILE)
        .register(SPECIALIST_B_PROFILE);
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
        defaultAgentId:   'orchestrator',
        transport,
        maxIterations:    30,
        iterationMode:    'auto',
    });
}
