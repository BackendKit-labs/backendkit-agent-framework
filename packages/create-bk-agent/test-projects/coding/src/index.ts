import 'dotenv/config';
import { selfAssertedIdentities } from '@backendkit-labs/agent-core';
import * as readline from 'readline';
import { createCodingEngine, TerminalTransport } from '@backendkit-labs/agent-coding';

// ── Provider setup ────────────────────────────────────────────────────────────

const provider = process.env.LLM_PROVIDER ?? 'anthropic';
const apiKey   = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? '';
const model    = process.env.LLM_MODEL;

if (!apiKey) {
    console.error('Missing API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');
    process.exit(1);
}

// ── Engine ────────────────────────────────────────────────────────────────────

const transport = new TerminalTransport();

const engine = createCodingEngine({
    // Who this agent is, and on whose behalf it acts (both are required). Swap `selfAssertedIdentities()` for your identity provider's.
    agentIdentity: selfAssertedIdentities(),
    identity: { userId: process.env.USERNAME ?? process.env.USER ?? 'me' },
    providers:       { [provider]: { apiKey, ...(model ? { model } : {}) } },
    defaultProvider: provider,
    workingDir:      process.cwd(),
    appName:         'my-coding-agent',
    transport,
});

// ── REPL ──────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
    rl.question('\n❯ ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === '/exit') { rl.close(); return; }
        await engine.run(trimmed);
        prompt();
    });
}

console.log('Coding agent ready. Type your request or /exit to quit.\n');
prompt();
