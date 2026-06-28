#!/usr/bin/env node
import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { INFRA_TOOLS } from './tools/index.js';
import { loadInfraSkills } from './load-skills.js';

// Domain skills loaded once at startup from ./skills/*.md (trigger-injected in the agentic loop).
const INFRA_SKILLS = loadInfraSkills();
if (INFRA_SKILLS.length > 0) {
    process.stderr.write(
        `[infra-mcp] ${INFRA_SKILLS.length} skill(s) cargada(s): ${INFRA_SKILLS.map(s => s.name).join(', ')}\n`,
    );
}

const PROVIDER_BASES: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai:   'https://api.openai.com/v1',
};

function resolveProviderConfig() {
    const provider = (process.env.LLM_PROVIDER ?? 'deepseek').toLowerCase();
    const model    = process.env.LLM_MODEL    ?? 'deepseek-chat';
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
        providers: { [provider]: { apiKey, model, baseUrl } },
        defaultProvider: provider,
        defaultAgent: 'infrastructure',  // run as the infra specialist, not the legacy 'general' profile
        transport,
        disablePersistence: true,
        extraSkills: INFRA_SKILLS,
    });
}

if (process.env.PROJECT_ROOT) {
    try { process.chdir(process.env.PROJECT_ROOT); } catch { /* ignore */ }
}

const server = new AgentMCPServer({
  name: 'infra-mcp',
  version: '1.0.0',
  tools: INFRA_TOOLS,
  engineFactory: (transport) => createEngine(transport),
});

await server.startStdio();
