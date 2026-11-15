import { createBaseEngine, type CallbackTransport } from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';
import { loadConfig, type Config } from './config';
import { ORCHESTRATOR_PROFILE } from './agents/orchestrator';
import { COMMITTER_PROFILE }    from './agents/committer';
import { BRANCHER_PROFILE }     from './agents/brancher';
import { MERGER_PROFILE }       from './agents/merger';
import { INSPECTOR_PROFILE }    from './agents/inspector';
import { RECOVERY_PROFILE }     from './agents/recovery';
import { ALL_GIT_TOOLS, READ_ONLY_GIT_TOOLS } from './tools/git-tools';

export type GitEngine = ReturnType<typeof createBaseEngine>;

export interface GitEngineOptions {
    /** Overrides GIT_AGENT_READONLY. */
    readOnly?: boolean;
    /** Overrides the environment-driven configuration (handy for tests). */
    config?: Config;
}

export function createGitEngine(transport: CallbackTransport, opts: GitEngineOptions = {}): GitEngine {
    const config = opts.config ?? loadConfig();
    const readOnly = opts.readOnly ?? config.readOnly;

    // One provider implementation shared by every agent package: retries, abort and usage reporting
    // come with it. Model and base URL are explicit so any OpenAI-compatible endpoint works.
    const provider = new OpenAICompatibleProvider({
        apiKey:  config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model:   config.llmModel,
        structuredOutput: config.structuredOutput,
        ...(config.thinking ? { thinking: config.thinking } : {}),
    });

    // Cost tracking needs prices; a budget cap needs both. Without prices the framework warns
    // instead of silently never triggering.
    const hasPrices = config.priceInPerM !== undefined || config.priceOutPerM !== undefined;
    const observability = hasPrices || config.budgetUsd !== undefined
        ? {
            costTracker: {
                ...(config.priceInPerM  !== undefined ? { inputPricePerMToken:  config.priceInPerM }  : {}),
                ...(config.priceOutPerM !== undefined ? { outputPricePerMToken: config.priceOutPerM } : {}),
                ...(config.budgetUsd    !== undefined ? { budget: { perRun: config.budgetUsd } }      : {}),
            },
        }
        : undefined;

    return createBaseEngine({
        providers:       { default: provider },
        defaultProvider: 'default',
        agents: [
            ORCHESTRATOR_PROFILE, COMMITTER_PROFILE, BRANCHER_PROFILE,
            MERGER_PROFILE, INSPECTOR_PROFILE, RECOVERY_PROFILE,
        ],
        tools:           readOnly ? READ_ONLY_GIT_TOOLS : ALL_GIT_TOOLS,
        defaultAgent:    'orchestrator',
        transport,
        maxIterations:   40,
        iterationMode:   'auto',
        workingDir:      process.cwd(),
        ...(observability ? { observability, abortOnBudget: config.budgetUsd !== undefined } : {}),
    });
}
