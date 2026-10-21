#!/usr/bin/env node
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { createCodingEngineFromConfig } from '@backendkit-labs/agent-coding';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT ?? '3011', 10);

// Cost controls (optional). AGENT_BUDGET_USD caps the spend of ONE tool call: the run is stopped once
// crossed. A cap and cost tracking need prices; use your model's price list (approximate is fine).
//   AGENT_BUDGET_USD=0.10  AGENT_PRICE_IN_PER_M=0.30  AGENT_PRICE_OUT_PER_M=1.20
function envNumber(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
    return n;
}

function costOptions() {
    const budget = envNumber('AGENT_BUDGET_USD');
    const priceIn = envNumber('AGENT_PRICE_IN_PER_M');
    const priceOut = envNumber('AGENT_PRICE_OUT_PER_M');
    if (budget === undefined && priceIn === undefined && priceOut === undefined) return {};
    return {
        observability: {
            costTracker: {
                ...(priceIn  !== undefined ? { inputPricePerMToken:  priceIn }  : {}),
                ...(priceOut !== undefined ? { outputPricePerMToken: priceOut } : {}),
                ...(budget   !== undefined ? { budget: { perRun: budget } }     : {}),
            },
        },
        abortOnBudget: budget !== undefined,
    };
}


const server = new AgentMCPServer({
    name:    'code-explainer',
    version: '1.0.0',
    port:    PORT,
    tools: [
        {
            name:        'explain',
            description: 'Explain what a piece of code does in plain English, without jargon.',
            schema: {
                code:     z.string().describe('The code to explain'),
                language: z.string().optional().describe('Programming language (e.g. typescript, python)'),
            },
            buildPrompt: ({ code, language }: { code: string; language?: string }) =>
                `Explain this ${language ?? 'code'} in plain English. Focus on WHAT it does, ` +
                `not HOW. Use one short paragraph then bullet points for key behaviors.\n\n` +
                `\`\`\`${language ?? ''}\n${code}\n\`\`\``,
        },
        {
            name:        'review',
            description: 'Review code for bugs, security issues, and improvements. Returns structured sections.',
            schema: {
                code:     z.string().describe('The code to review'),
                language: z.string().optional().describe('Programming language'),
                focus:    z.string().optional().describe('Specific focus: security | performance | readability | all (default)'),
            },
            buildPrompt: ({ code, language, focus }: { code: string; language?: string; focus?: string }) =>
                `Review this ${language ?? 'code'} with focus on ${focus ?? 'all concerns'}. ` +
                `Format: ## Bugs, ## Security, ## Performance, ## Suggestions. ` +
                `Only include sections with findings.\n\n` +
                `\`\`\`${language ?? ''}\n${code}\n\`\`\``,
        },
        {
            name:        'add_docstrings',
            description: 'Add JSDoc/Google/Sphinx documentation comments to code and return the documented version.',
            schema: {
                code:     z.string().describe('The code to document'),
                language: z.string().optional().describe('Programming language'),
                style:    z.string().optional().describe('Doc style: JSDoc | Google | Sphinx | XML (auto-detected if omitted)'),
            },
            buildPrompt: ({ code, language, style }: { code: string; language?: string; style?: string }) =>
                `Add ${style ? style + ' style' : 'appropriate'} documentation comments to this ` +
                `${language ?? 'code'}. Return ONLY the documented code, no explanation.\n\n` +
                `\`\`\`${language ?? ''}\n${code}\n\`\`\``,
        },
    ],
    engineFactory: (transport: CallbackTransport) =>
        // costOptions() adds the optional per-call spending cap.
        createCodingEngineFromConfig({ appName: 'code-explainer', transport, ...costOptions() }),
});

process.on('SIGINT', () => {
    process.stderr.write('\n[code-explainer] shutting down…\n');
    setTimeout(() => process.exit(0), 1000);
    server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});

server.start().catch(err => { console.error(err); process.exit(1); });
