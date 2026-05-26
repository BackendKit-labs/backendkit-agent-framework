#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { skillsSearch } from './tools/skills/search.js';
import { skillsInstall } from './tools/skills/install.js';
import { skillsList } from './tools/skills/list.js';

const APP_NAME = process.env.BK_APP_NAME ?? 'deepseek-code';
const CWD = process.env.BK_CWD ?? process.cwd();

const server = new McpServer({
    name: '@bk/mcp-server',
    version: '0.1.0',
});

// ---------------------------------------------------------------------------
// skills_search
// ---------------------------------------------------------------------------
// @ts-expect-error: TS2589 — MCP SDK + zod generic depth limit, safe at runtime
server.tool(
    'skills_search',
    'Search available skills by query. Returns matching skills and whether they are active for the current project.',
    {
        query: z.string().describe('Search term — skill name, trigger keyword, or description'),
        cwd: z.string().optional().describe('Project directory to detect stack (defaults to server cwd)'),
    },
    async ({ query, cwd }) => {
        const results = await skillsSearch(query, cwd ?? CWD, APP_NAME);
        if (results.length === 0) {
            return { content: [{ type: 'text', text: `No skills found matching "${query}".` }] };
        }
        const lines = results.map(s => {
            const tags = [s.scope, ...(s.language ?? []), s.active ? 'ACTIVE' : ''].filter(Boolean);
            return `- **${s.name}** [${tags.join(', ')}]\n  ${s.description}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
);

// ---------------------------------------------------------------------------
// skills_install
// ---------------------------------------------------------------------------
server.tool(
    'skills_install',
    'Install a skill pack from a GitHub repository or local path.',
    {
        source: z.string().describe('GitHub URL (https://github.com/org/repo) or local path'),
        skill: z.string().optional().describe('Install only this specific skill by name'),
        pack: z.string().optional().describe('Override the derived pack name'),
    },
    async ({ source, skill, pack }) => {
        const result = await skillsInstall(source, APP_NAME, { skill, pack });
        if (!result.ok) {
            return {
                content: [{
                    type: 'text',
                    text: `Failed to install from "${source}":\n${result.error}`,
                }],
                isError: true,
            };
        }
        return {
            content: [{
                type: 'text',
                text: `Installed pack "${result.pack}" with ${result.skillsInstalled} skill(s).`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// skills_list
// ---------------------------------------------------------------------------
server.tool(
    'skills_list',
    'List all installed skill packs including builtin packs.',
    {},
    async () => {
        const packs = await skillsList(APP_NAME);
        const lines = packs.map(p => {
            const tag = p.builtin ? 'builtin' : `installed ${p.installedAt.slice(0, 10)}`;
            return `**${p.pack}** (${tag})\n  Skills: ${p.skills.join(', ')}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    process.stderr.write(`[bk-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
