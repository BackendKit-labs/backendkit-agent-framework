#!/usr/bin/env node
import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { SECURITY_TOOLS } from './tools/index.js';
import { loadSecuritySkills } from './load-skills.js';

// Domain skills loaded once at startup from ./skills/*.md (trigger-injected in the agentic loop).
// Complements the framework's builtin OWASP `security-checklist` skill.
const SECURITY_SKILLS = loadSecuritySkills();
if (SECURITY_SKILLS.length > 0) {
    process.stderr.write(
        `[security-mcp] ${SECURITY_SKILLS.length} skill(s) cargada(s): ${SECURITY_SKILLS.map(s => s.name).join(', ')}\n`,
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
        defaultAgent: 'security',      // run as the security specialist, not the legacy 'general' profile
        transport,
        disablePersistence: true,
        extraSkills: SECURITY_SKILLS,
    });
}

if (process.env.PROJECT_ROOT) {
    try { process.chdir(process.env.PROJECT_ROOT); } catch { /* ignore */ }
}

const server = new AgentMCPServer({
  name: 'security-mcp',
  version: '1.0.0',
  tools: SECURITY_TOOLS,
  engineFactory: (transport) => createEngine(transport),
});

await server.startStdio();
