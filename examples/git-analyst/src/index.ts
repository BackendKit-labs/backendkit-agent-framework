#!/usr/bin/env node
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { createCodingEngineFromConfig } from '@backendkit-labs/agent-coding';
import { CallbackTransport, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT ?? '3010', 10);
const CWD  = process.env.AGENT_CWD ?? process.cwd();

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
    name:    'git-analyst',
    version: '1.0.0',
    port:    PORT,
    tools: [
        {
            name:        'git_summarize',
            description: 'Summarize recent git commits grouped by features, bug fixes, and chores.',
            schema: {
                cwd:         z.string().optional().describe('Repository path (defaults to server cwd)'),
                max_commits: z.number().optional().describe('Number of commits to analyze (default 20)'),
            },
            buildPrompt: ({ cwd, max_commits }: { cwd?: string; max_commits?: number }) =>
                `Run the command: git -C "${cwd ?? CWD}" log --oneline -${max_commits ?? 20}\n` +
                `Then write a concise summary grouped by: Features, Bug Fixes, and Chores. Be brief.`,
        },
        {
            name:        'git_diff_review',
            description: 'Review a git diff and identify bugs, security issues, and missing tests.',
            schema: {
                diff: z.string().describe('The output of git diff to review'),
            },
            buildPrompt: ({ diff }: { diff: string }) =>
                `Review this git diff. Identify: potential bugs, security issues, missing test cases, ` +
                `and positive highlights. Be concise.\n\n\`\`\`diff\n${diff}\n\`\`\``,
        },
        {
            name:        'git_release_notes',
            description: 'Generate professional release notes in markdown from recent commits.',
            schema: {
                cwd:      z.string().optional().describe('Repository path'),
                from_tag: z.string().optional().describe('Starting tag or commit SHA (e.g. v1.0.0)'),
            },
            buildPrompt: ({ cwd, from_tag }: { cwd?: string; from_tag?: string }) => {
                const dir = cwd ?? CWD;
                const logCmd = from_tag
                    ? `git -C "${dir}" log --oneline ${from_tag}..HEAD`
                    : `git -C "${dir}" log --oneline -30`;
                return (
                    `Run: ${logCmd}\n` +
                    `Then generate professional release notes in markdown format. ` +
                    `Sections: ## Features, ## Bug Fixes, ## Breaking Changes. ` +
                    `Skip commits with no user-facing impact.`
                );
            },
        },
    ],
    engineFactory: (transport: CallbackTransport) =>
        // costOptions() adds the optional per-call spending cap.
        createCodingEngineFromConfig({
            appName: 'git-analyst', transport, ...costOptions(),
            // Who this agent is and on whose behalf it acts: both are required.
            agentIdentity: selfAssertedIdentities(),
            identity: { userId: process.env.USERNAME ?? process.env.USER ?? 'me' },
        }),
});

process.on('SIGINT', () => {
    process.stderr.write('\n[git-analyst] shutting down…\n');
    setTimeout(() => process.exit(0), 1000);
    server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});

server.start().catch(err => { console.error(err); process.exit(1); });
