import 'dotenv/config';
import * as os from 'os';
import * as path from 'path';
import { createAutonomousAgent, createMemorySystem, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';

// ── Agent definition ──────────────────────────────────────────────────────────

const monitorAgent: AgentProfile = {
    id: 'monitor',
    name: 'Monitor',
    icon: '👁',
    description: 'Monitors events and executes scheduled tasks',
    allowedTools: [],
    delegatesTo: [],
    systemPrompt: `You are an autonomous monitor agent.
// TODO: describe what this agent monitors and what actions it takes.
When activated by a trigger, analyze the input and take appropriate action.`,
};

// ── Provider ──────────────────────────────────────────────────────────────────

const provider = process.env.LLM_PROVIDER ?? 'anthropic';
const apiKey   = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '';

if (!apiKey) { console.error('Missing API key'); process.exit(1); }

// ── Memory — persists context between trigger executions ──────────────────────

const APP_DIR = path.join(os.homedir(), '.my-autonomous-agent');
const MEM_DIR = path.join(APP_DIR, 'memory');

const memory = createMemorySystem({
    episodic:   { provider: 'json', path: path.join(MEM_DIR, 'episodes.json') },
    semantic:   { provider: 'json', path: path.join(MEM_DIR, 'knowledge.json') },
    procedural: { provider: 'json', path: path.join(MEM_DIR, 'patterns.json') },
    retention:  { maxEpisodes: 200 },
});

// ── Autonomous agent ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agent = createAutonomousAgent({
    // Who this agent is, and on whose behalf it acts (both are required). Swap `selfAssertedIdentities()` for your identity provider's.
    agentIdentity: selfAssertedIdentities(),
    identity: { userId: process.env.USERNAME ?? process.env.USER ?? 'me' },
    providers:       { [provider]: { apiKey } } as any,
    defaultProvider: provider,
    agents:          [monitorAgent],
    defaultAgent:    'monitor',
    goal:            'TODO: describe the agent goal',
    memorySystem:    memory,

    triggers: [
        // Run every day at 9:00 AM
        {
            type: 'schedule',
            cron: '0 9 * * *',
            task: 'Run daily check and report findings',
        },

        // Listen for webhook events (e.g. from GitHub, Slack, etc.)
        {
            type:   'webhook',
            path:   '/events',
            // secret: process.env.WEBHOOK_SECRET,
        },

        // TODO: add more triggers as needed
        // { type: 'event', topic: 'my.custom.event' },
    ],

    webhookPort: parseInt(process.env.WEBHOOK_PORT ?? '3000'),
});

// ── Start ─────────────────────────────────────────────────────────────────────

void (async () => {
    await agent.start();
    console.log('Autonomous agent started.');
    console.log('Webhook listening on port', process.env.WEBHOOK_PORT ?? 3000);
    console.log(`Memory stored in: ${APP_DIR}`);

    process.on('SIGTERM', async () => { await agent.stop(); process.exit(0); });
    process.on('SIGINT',  async () => { await agent.stop(); process.exit(0); });
})();
