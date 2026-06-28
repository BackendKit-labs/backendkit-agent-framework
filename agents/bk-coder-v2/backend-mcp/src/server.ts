#!/usr/bin/env node
import 'dotenv/config';
import { AgentMCPServer }     from '@backendkit-labs/mcp-server';
import { CallbackTransport }  from '@backendkit-labs/agent-core';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { BACKEND_TOOLS }      from './tools/index.js';
import { loadBackendSkills }  from './load-skills.js';

// Domain skills loaded once at startup from ./skills/*.md (Enfoque B: progressive
// disclosure inside the agentic loop — trigger-matched, injected into the system prompt).
const BACKEND_SKILLS = loadBackendSkills();
if (BACKEND_SKILLS.length > 0) {
    process.stderr.write(
        `[backend-mcp] ${BACKEND_SKILLS.length} skill(s) cargada(s): ${BACKEND_SKILLS.map(s => s.name).join(', ')}\n`,
    );
}

// ── Provider configuration from environment ───────────────────────────────────
// Supports any OpenAI-compatible endpoint (DeepSeek, OpenAI, local models).
// Set LLM_PROVIDER + LLM_MODEL + the corresponding API key env var.
//
// Examples:
//   LLM_PROVIDER=deepseek  LLM_MODEL=deepseek-chat     DEEPSEEK_API_KEY=sk-...
//   LLM_PROVIDER=openai    LLM_MODEL=gpt-4o             OPENAI_API_KEY=sk-...
//   LLM_PROVIDER=deepseek  LLM_MODEL=deepseek-reasoner  DEEPSEEK_API_KEY=sk-...

const PROVIDER_BASES: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai:   'https://api.openai.com/v1',
    groq:     'https://api.groq.com/openai/v1',
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
        providers: {
            [provider]: { apiKey, model, baseUrl },
        },
        defaultProvider: provider,
        defaultAgent: 'backend',       // run as the backend specialist, not the legacy 'general' profile
        transport,
        disablePersistence: true,
        extraSkills: BACKEND_SKILLS,   // domain skills survive disablePersistence
    });
}

// Change to project root so agent-coding's path-sandbox allows reading project files
if (process.env.PROJECT_ROOT) {
    try { process.chdir(process.env.PROJECT_ROOT); } catch { /* ignore */ }
}

const server = new AgentMCPServer({
    name:          'backend-mcp',
    version:       '1.0.0',
    tools:         BACKEND_TOOLS,
    engineFactory: (transport) => createEngine(transport),
});

await server.startStdio();
