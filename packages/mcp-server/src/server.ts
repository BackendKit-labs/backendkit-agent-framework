#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as path from 'path';
import { getFrameworkDir } from '@backendkit-labs/agent-core';
import { skillsSearch } from './tools/skills/search.js';
import { skillsInstall } from './tools/skills/install.js';
import { skillsList } from './tools/skills/list.js';
import { codeSearch } from './tools/code/search.js';
import { codeContext } from './tools/code/context.js';
import { GraphStore } from './indexer/graph-store.js';
import { CodeIndexer } from './indexer/indexer.js';
import { FileWatcher } from './indexer/watcher.js';
import { detectStackFromGraph } from './indexer/stack-detector.js';
import { registerPlatformResources } from './resources/platform-resources.js';
import { extraIndexRoots, isLoopbackRequest, readJsonBody, replyRequestError, resolveInside } from './request-guards.js';
import { SessionRegistry } from './session-registry.js';

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

// ---------------------------------------------------------------------------
// Server factory — creates a fresh McpServer with all tools registered.
// Called once for stdio mode; called per-session in HTTP mode.
// ---------------------------------------------------------------------------
function buildServer(bearerToken?: string): McpServer {
    const srv = new McpServer({
        name: '@backendkit-labs/mcp-server',
        version: '0.2.0',
    });
    registerTools(srv);
    registerPlatformResources(srv, bearerToken);
    return srv;
}

function registerTools(srv: McpServer): void {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = srv.tool.bind(srv) as any;

// ---------------------------------------------------------------------------
// stack_detect
// ---------------------------------------------------------------------------
t(
    'stack_detect',
    'Detect the technology stack of the current project using the code index (languages, frameworks, libraries).',
    {
        cwd: z.string().optional().describe('Project directory (defaults to server cwd)'),
    },
    async ({ cwd: _cwd }: { cwd?: string }) => {
        const graphTech = detectStackFromGraph(store);
        const { detectStack } = await import('@backendkit-labs/agent-coding/cli');
        const fileTech = await detectStack(CWD);
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
t(
    'skills_search',
    'Search available skills by query. Returns matching skills and whether they are active for the current project.',
    {
        query: z.string().describe('Search term — skill name, trigger keyword, or description'),
        cwd: z.string().optional().describe('Project directory to detect stack (defaults to server cwd)'),
    },
    async ({ query, cwd }: { query: string; cwd?: string }) => {
        // Merge file-based + graph-based stack detection
        const { detectStack } = await import('@backendkit-labs/agent-coding/cli');
        const fileTech = await detectStack(cwd ?? CWD);
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
t(
    'skills_install',
    'Install a skill pack from a GitHub repository or local path.',
    {
        source: z.string().describe('GitHub URL (https://github.com/org/repo) or local path'),
        skill: z.string().optional().describe('Install only this specific skill by name'),
        pack: z.string().optional().describe('Override the derived pack name'),
    },
    async ({ source, skill, pack }: { source: string; skill?: string; pack?: string }) => {
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
t(
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
t(
    'code_search',
    'Search the codebase for symbols (functions, classes, interfaces, types) by name or keyword.',
    {
        query: z.string().describe('Symbol name or keyword to search for'),
        limit: z.number().optional().describe('Max results to return (default 20)'),
    },
    ({ query, limit }: { query: string; limit?: number }) => {
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
t(
    'code_context',
    'Get relevant code context for a task — finds the symbols most related to the task and returns their code, callers, and callees.',
    {
        task: z.string().describe('Task or feature description to find context for'),
        max_symbols: z.number().optional().describe('Max symbols to return (default 10)'),
    },
    async ({ task, max_symbols }: { task: string; max_symbols?: number }) => {
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
t(
    'code_index',
    'Trigger a full re-index of the project codebase. Run this after installing new files or if search results seem stale.',
    {
        cwd: z.string().optional().describe('Directory to index (defaults to server cwd)'),
    },
    async ({ cwd }: { cwd?: string }) => {
        // the client picks the directory, and what gets indexed can be read back with code_context:
        // it must stay inside the working directory (or BK_INDEX_ROOTS)
        let dir: string;
        try {
            dir = cwd ? await resolveInside([CWD, ...extraIndexRoots()], cwd) : CWD;
        } catch (err) {
            return { isError: true, content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] };
        }
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

} // end registerTools

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const HTTP_MODE = args.includes('--http');
const portEq    = args.find(a => a.startsWith('--port='))?.split('=')[1];
const portSpace = args[args.indexOf('--port') + 1];
const HTTP_PORT = parseInt(portEq ?? portSpace ?? '3001', 10);
const MCP_PATH  = '/mcp';

async function main() {
    // Index on startup (non-blocking)
    indexer.indexDirectory(CWD).catch(() => undefined);
    watcher.start(CWD, indexer);

    process.on('SIGINT', async () => {
        await watcher.stop();
        store.close();
        process.exit(0);
    });

    if (HTTP_MODE) {
        await startHttp();
    } else {
        await startStdio();
    }
}

async function startStdio() {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
}

async function startHttp() {
    // Stateful mode — each client gets a session ID; the McpServer is shared but
    // each transport instance tracks its own protocol state independently.
    const sessions = new SessionRegistry<StreamableHTTPServerTransport>();

    const parseBody = (req: IncomingMessage): Promise<unknown> => readJsonBody(req);

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // bound to 127.0.0.1, yet reachable from a web page in the user's browser (DNS rebinding / cross-site POST)
        if (!isLoopbackRequest(req.headers.host, req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden host or origin' }));
            return;
        }

        if (req.url !== MCP_PATH) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Use POST/GET ${MCP_PATH}` }));
            return;
        }

        try {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;

            // Existing session
            if (sessionId && sessions.has(sessionId)) {
                const body = req.method === 'POST' ? await parseBody(req) : undefined;
                await sessions.get(sessionId)!.handleRequest(req, res, body);
                return;
            }

            // New session — only allowed on POST (initialize request)
            if (req.method !== 'POST') {
                res.writeHead(400);
                res.end('Session ID required for GET');
                return;
            }

            if (sessions.isFull()) {
                res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
                res.end(JSON.stringify({ error: 'Too many open sessions' }));
                return;
            }

            const body = await parseBody(req);
            const bearerToken = req.headers['authorization'] as string | undefined;
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
            });

            // Connect a fresh McpServer per session so each session has
            // isolated protocol state (initialized, tool list, etc.)
            const sessionServer = buildServer(bearerToken);
            await sessionServer.connect(transport);

            // handleRequest processes the initialize message and sets transport.sessionId
            await transport.handleRequest(req, res, body);

            // Store AFTER handleRequest so the session ID is available
            if (transport.sessionId) {
                sessions.set(transport.sessionId, transport);
                transport.onclose = () => sessions.delete(transport.sessionId!);
            }
        } catch (err) {
            replyRequestError(res, err, line => process.stderr.write(`[bk-mcp] ${line}\n`));
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
            process.stderr.write(
                `[bk-mcp] HTTP server listening on http://127.0.0.1:${HTTP_PORT}${MCP_PATH}\n` +
                `[bk-mcp] cwd=${CWD}  app=${APP_NAME}\n`,
            );
            resolve();
        });
    });
}

main().catch(err => {
    process.stderr.write(`[bk-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
