#!/usr/bin/env node
import 'dotenv/config';
import { AgentMCPServer }     from '@backendkit-labs/mcp-server';
import { CallbackTransport }  from '@backendkit-labs/agent-core';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { QA_TOOLS }           from './tools/index.js';
import { loadQaSkills }       from './load-skills.js';

// Domain skills loaded once at startup from ./skills/*.md (trigger-injected in the agentic loop).
const QA_SKILLS = loadQaSkills();
if (QA_SKILLS.length > 0) {
    process.stderr.write(
        `[qa-mcp] ${QA_SKILLS.length} skill(s) cargada(s): ${QA_SKILLS.map(s => s.name).join(', ')}\n`,
    );
}

// QA uses deepseek-reasoner by default — deeper reasoning for spec validation.
// Override with LLM_MODEL env var if needed.

const PROVIDER_BASES: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai:   'https://api.openai.com/v1',
    anthropic: '',   // handled natively by agent-coding
};

function resolveProviderConfig() {
    const provider = (process.env.LLM_PROVIDER ?? 'deepseek').toLowerCase();
    const model    = process.env.LLM_MODEL    ?? 'deepseek-reasoner';   // reasoning model
    const baseUrl  = process.env.LLM_BASE_URL ?? PROVIDER_BASES[provider] ?? PROVIDER_BASES.deepseek;
    const apiKey   = process.env.LLM_API_KEY
                  ?? process.env[`${provider.toUpperCase()}_API_KEY`]
                  ?? process.env.DEEPSEEK_API_KEY
                  ?? '';

    return { provider, model, baseUrl, apiKey };
}

function createEngine(transport: CallbackTransport) {
    const { provider, model, baseUrl, apiKey } = resolveProviderConfig();
    return createCodingEngine({
        providers: {
            [provider]: { apiKey, model, baseUrl },
        },
        defaultProvider: provider,
        defaultAgent: 'qa-engineer',   // run as the QA specialist, not the legacy 'general' profile
        transport,
        disablePersistence: true,
        extraSkills: QA_SKILLS,
    });
}

if (process.env.PROJECT_ROOT) {
    try { process.chdir(process.env.PROJECT_ROOT); } catch { /* ignore */ }
}

const server = new AgentMCPServer({
    name:          'qa-mcp',
    version:       '1.0.0',
    tools:         QA_TOOLS,
    engineFactory: (transport) => createEngine(transport),
});

await server.startStdio();
