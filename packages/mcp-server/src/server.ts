#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import { getFrameworkDir } from '@bk/agent-core';
import { skillsSearch } from './tools/skills/search.js';
import { skillsInstall } from './tools/skills/install.js';
import { skillsList } from './tools/skills/list.js';
import { codeSearch } from './tools/code/search.js';
import { codeContext } from './tools/code/context.js';
import { GraphStore } from './indexer/graph-store.js';
import { CodeIndexer } from './indexer/indexer.js';
import { FileWatcher } from './indexer/watcher.js';
import { detectStackFromGraph } from './indexer/stack-detector.js';

const APP_NAME = process.env.BK_APP_NAME ?? 'deepseek-code';
const CWD = process.env.BK_CWD ?? process.cwd();

// --- Code index setup ---
const dbPath = path.join(
    getFrameworkDir(APP_NAME),
    'code-index',
    Buffer.from(CWD).toString('base64url').slice(0, 32) + '.db',
);
const store = new GraphStore(dbPath);
const indexer = new CodeIndexer(store, CWD);
const watcher = new FileWatcher();

const server = new McpServer({
    name: '@bk/mcp-server',
    version: '0.2.0',
});

// ---------------------------------------------------------------------------
// stack_detect
// ---------------------------------------------------------------------------
server.tool(
    'stack_detect',
    'Detect the technology stack of the current project using the code index (languages, frameworks, libraries).',
    {
        cwd: z.string().optional().describe('Project directory (defaults to server cwd)'),
    },
    async ({ cwd: _cwd }) => {
        const graphTech = detectStackFromGraph(store);
        const { SkillActivator } = await import('@bk/agent-core');
        const activator = new SkillActivator();
        const fileTech = await activator.detectStack(CWD);
        const all = [...new Set([...fileTech, ...graphTech])].sort();
        return {
            content: [{
                type: 'text',
                text: all.length
                    ? `Detected stack: ${all.join(', ')}`
                    : 'No stack detected yet. Run code_index first.',
            }],
        };
    },
);

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
        // Merge file-based + graph-based stack detection
        const { SkillActivator } = await import('@bk/agent-core');
        const activator = new SkillActivator();
        const fileTech = await activator.detectStack(cwd ?? CWD);
        const graphTech = detectStackFromGraph(store);
        const enrichedStack = [...new Set([...fileTech, ...graphTech])];

        const results = await skillsSearch(query, cwd ?? CWD, APP_NAME);
        if (results.length === 0) {
            return { content: [{ type: 'text', text: `No skills found matching "${query}".` }] };
        }
        const lines = results.map(s => {
            const tags = [s.scope, ...(s.language ?? []), s.active ? 'ACTIVE' : ''].filter(Boolean);
            const stackMatch = s.language?.some(l => enrichedStack.includes(l));
            const marker = stackMatch ? ' ✓' : '';
            return `- **${s.name}**${marker} [${tags.join(', ')}]\n  ${s.description}`;
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
                content: [{ type: 'text', text: `Failed to install from "${source}":\n${result.error}` }],
                isError: true,
            };
        }
        return {
            content: [{ type: 'text', text: `Installed pack "${result.pack}" with ${result.skillsInstalled} skill(s).` }],
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
// code_search
// ---------------------------------------------------------------------------
server.tool(
    'code_search',
    'Search the codebase for symbols (functions, classes, interfaces, types) by name or keyword.',
    {
        query: z.string().describe('Symbol name or keyword to search for'),
        limit: z.number().optional().describe('Max results to return (default 20)'),
    },
    ({ query, limit }) => {
        const results = codeSearch(query, store, limit ?? 20);
        if (results.length === 0) {
            return { content: [{ type: 'text', text: `No symbols found matching "${query}".` }] };
        }
        const lines = results.map(r =>
            `**${r.name}** (${r.kind}) — ${r.filePath}:${r.startLine}\n  ${r.signature}`,
        );
        return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    },
);

// ---------------------------------------------------------------------------
// code_context
// ---------------------------------------------------------------------------
server.tool(
    'code_context',
    'Get relevant code context for a task — finds the symbols most related to the task and returns their code, callers, and callees.',
    {
        task: z.string().describe('Task or feature description to find context for'),
        max_symbols: z.number().optional().describe('Max symbols to return (default 10)'),
    },
    async ({ task, max_symbols }) => {
        const ctx = await codeContext(task, store, max_symbols ?? 10);
        if (ctx.symbols.length === 0) {
            return { content: [{ type: 'text', text: `No relevant code found for: "${task}"` }] };
        }
        const parts = ctx.symbols.map(s => {
            const location = `${s.filePath}:${s.startLine}-${s.endLine}`;
            const relations = [
                s.calledBy.length ? `calledBy: ${s.calledBy.slice(0, 5).join(', ')}` : '',
                s.calls.length ? `calls: ${s.calls.slice(0, 5).join(', ')}` : '',
            ].filter(Boolean).join(' | ');
            return [
                `### ${s.name} (${s.kind}) — ${location}`,
                relations ? `> ${relations}` : '',
                '```' + s.language,
                s.snippet,
                '```',
            ].filter(Boolean).join('\n');
        });
        return { content: [{ type: 'text', text: parts.join('\n\n') }] };
    },
);

// ---------------------------------------------------------------------------
// code_index (trigger manual re-index)
// ---------------------------------------------------------------------------
server.tool(
    'code_index',
    'Trigger a full re-index of the project codebase. Run this after installing new files or if search results seem stale.',
    {
        cwd: z.string().optional().describe('Directory to index (defaults to server cwd)'),
    },
    async ({ cwd }) => {
        const dir = cwd ?? CWD;
        const result = await indexer.indexDirectory(dir);
        const stats = store.stats();
        return {
            content: [{
                type: 'text',
                text: `Indexed ${result.files} files, ${result.symbols} new symbols.\nTotal: ${stats.nodes} nodes, ${stats.edges} edges across ${stats.files} files.`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
    // Index on startup (non-blocking — don't await fully)
    indexer.indexDirectory(CWD).catch(() => undefined);
    watcher.start(CWD, indexer);

    process.on('SIGINT', async () => {
        await watcher.stop();
        store.close();
        process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    process.stderr.write(`[bk-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
