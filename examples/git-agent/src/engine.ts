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
import { COMMITTER_PROFILE }    from './agents/committer';
import { BRANCHER_PROFILE }     from './agents/brancher';
import { MERGER_PROFILE }       from './agents/merger';
import { INSPECTOR_PROFILE }    from './agents/inspector';
import { RECOVERY_PROFILE }     from './agents/recovery';
import { ALL_GIT_TOOLS }        from './tools/git-tools';

export function createGitEngine(transport: CallbackTransport): AgentEngine {
    const config = loadConfig();

    const tools = new ToolRegistry();
    for (const tool of ALL_GIT_TOOLS) tools.register(tool);

    const agents = new AgentRegistry();
    agents
        .register(ORCHESTRATOR_PROFILE)
        .register(COMMITTER_PROFILE)
        .register(BRANCHER_PROFILE)
        .register(MERGER_PROFILE)
        .register(INSPECTOR_PROFILE)
        .register(RECOVERY_PROFILE);

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
        defaultProvider: 'default',
        defaultAgentId:  'orchestrator',
        transport,
        maxIterations:   40,
        iterationMode:   'auto',
        workingDir:      process.cwd(),
    });
}
