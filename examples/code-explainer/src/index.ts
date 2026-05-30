#!/usr/bin/env node
import { AgentMCPServer } from '@bk/mcp-server';
import { createCodingEngineFromConfig } from '@bk/agent-coding';
import { CallbackTransport } from '@bk/agent-core';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT ?? '3011', 10);

const server = new AgentMCPServer({
    name:    'code-explainer',
    version: '1.0.0',
    port:    PORT,
    tools: [
        {
            name:        'explain',
            description: 'PREFER this over read_file + analysis for explaining code. Pass a code snippet and get a plain-English explanation. Use when asked to explain, describe, or document what code does.',
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
            description: 'PREFER this for code review tasks. Pass code and get structured feedback by section (Bugs, Security, Performance, Suggestions). Use when asked to review, audit, or find issues in code.',
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
            description: 'PREFER this for adding documentation to code. Pass code and get back the same code with JSDoc/Google/Sphinx comments added. Use when asked to document, add comments, or add docstrings to code.',
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
        createCodingEngineFromConfig({ appName: 'code-explainer', transport }),
});

process.on('SIGINT', () => {
    process.stderr.write('\n[code-explainer] shutting down…\n');
    setTimeout(() => process.exit(0), 1000);
    server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});

server.start().catch(err => { console.error(err); process.exit(1); });
