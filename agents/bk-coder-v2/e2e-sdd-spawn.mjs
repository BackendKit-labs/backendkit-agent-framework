// (c) End-to-end validation of the REAL spawn path the orchestrator uses.
// Replicates callMcpTool: spawns backend-mcp/dist/server.js as a child MCP process,
// calls implement_phase exactly as PhaseRunner does, and proves:
//   1. the skill LOADS inside the spawned process (stderr: "[backend-mcp] … cargada")
//   2. the skill SHAPES the output (layered controller/service/repository files on disk)
// Requires DEEPSEEK_API_KEY. Run: node e2e-sdd-spawn.mjs

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client }               from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

const here       = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'backend-mcp', 'dist', 'server.js');

// ── Real project with .specs/ — what implement_phase reads ────────────────────
const root = mkdtempSync(path.join(tmpdir(), 'sdd-e2e-'));
mkdirSync(path.join(root, '.specs'), { recursive: true });
mkdirSync(path.join(root, 'src'), { recursive: true });
writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sdd-e2e', type: 'module' }, null, 2));
writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
writeFileSync(path.join(root, '.specs', 'specification.md'),
`# Spec — Order service
RF-1: Expose a REST API for an "order" resource (list, get, create, update, delete).
RF-2: An order has id, customer, total, status.
RF-3: Validate inputs at the API boundary.`);
writeFileSync(path.join(root, '.specs', 'ROADMAP.md'),
`# Roadmap
## Phase 1: Order REST API
Build the REST endpoints for the order resource.
- [ ] CRUD endpoints for orders
- [ ] Input validation at the boundary
- [ ] Errors mapped to HTTP status codes`);

console.log(`project: ${root}\nspawning: ${serverPath}\n`);

// ── Spawn the real MCP server (same as callMcpTool) ───────────────────────────
let stderrBuf = '';
const transport = new StdioClientTransport({
    command: process.execPath,
    args:    [serverPath],
    env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
        LLM_PROVIDER: 'deepseek',
        LLM_MODEL:    'deepseek-chat',
        DEEPSEEK_API_KEY: apiKey,
        PROJECT_ROOT: root,
    },
    stderr: 'pipe',
});

const client = new Client({ name: 'sdd-e2e', version: '1.0.0' }, { capabilities: {} });

function collect(dir) {
    const out = [];
    const walk = (d) => { for (const e of readdirSync(d)) { const f = path.join(d, e);
        if (statSync(f).isDirectory()) { if (e !== 'node_modules') walk(f); } else out.push(f); } };
    try { walk(dir); } catch {}
    return out;
}

try {
    await client.connect(transport);
    transport.stderr?.on('data', (d) => { stderrBuf += d.toString(); });

    const t0 = Date.now();
    console.log('→ calling implement_phase (real spawned agent loop)…');
    const res = await client.callTool(
        { name: 'implement_phase', arguments: {
            projectRoot: root, phaseNumber: 1, phaseTitle: 'Order REST API',
            criteria: ['CRUD endpoints for orders', 'Input validation at the boundary', 'Errors mapped to HTTP status codes'],
        } },
        undefined, { timeout: 540_000 },
    );
    const secs = Math.round((Date.now() - t0) / 1000);
    const summary = (res.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');

    const files = collect(path.join(root, 'src')).map(f => path.basename(f));
    const lower = files.join(' ').toLowerCase();
    const layered = /controller/.test(lower) && /service/.test(lower) && /(repository|repositor)/.test(lower);
    const skillLoaded = /\[backend-mcp\].*cargada/i.test(stderrBuf) && /rest-resource/i.test(stderrBuf);

    console.log(`\n── results (${secs}s) ──`);
    console.log(`1. skill loaded in spawned process: ${skillLoaded ? '✓' : '✗'}`);
    const m = stderrBuf.match(/\[backend-mcp\][^\n]*cargada[^\n]*/i);
    if (m) console.log(`     stderr: ${m[0]}`);
    console.log(`2. files written (${files.length}): ${files.join(', ')}`);
    console.log(`3. layered controller/service/repository: ${layered ? '✓' : '✗'}`);
    console.log(`\nagent summary (first 400 chars):\n${summary.slice(0, 400)}`);

    console.log(`\n${skillLoaded && layered ? '✓ E2E CONFIRMED — skill loads AND shapes output in the real spawned MCP path.'
        : skillLoaded ? '◐ skill loaded in real process; layering not detected on disk (inspect output).'
        : '✗ skill did not load in the spawned process — investigate.'}`);
} catch (err) {
    console.error('ERROR:', err?.message ?? err);
    if (stderrBuf) console.error('child stderr:\n' + stderrBuf.slice(-1500));
    process.exitCode = 1;
} finally {
    await client.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
}
