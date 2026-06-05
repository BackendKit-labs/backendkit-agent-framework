#!/usr/bin/env node
/**
 * B.9 — Tests for the `add` command modules
 * Simulates a scaffolded multi-agent project and exercises each add/* module.
 * No npm install is performed — only file generation and patching are tested.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const require = createRequire(import.meta.url);
const { detectProject }   = require('../dist/src/add/detector.js');
const { addServer }       = require('../dist/src/add/modules/server.js');
const { addSpecialist }   = require('../dist/src/add/modules/specialist.js');
const { addTools }        = require('../dist/src/add/modules/tools.js');
const { addMcpClient }    = require('../dist/src/add/modules/mcp-client.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  ${PASS} ${label}`);
    } else {
        console.log(`  ${FAIL} ${label}${detail ? '  ← ' + detail : ''}`);
        failures++;
    }
}

function fileContains(file, str) {
    if (!fs.existsSync(file)) return false;
    return fs.readFileSync(file, 'utf-8').includes(str);
}

// ── Fake project factory ──────────────────────────────────────────────────────

function createFakeProject(type = 'multi-agent') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-add-test-'));
    fs.mkdirSync(path.join(dir, 'src', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'tools'),  { recursive: true });

    const pkg = {
        name: 'test-project',
        version: '0.1.0',
        dependencies: { '@backendkit-labs/agent-core': '^0.16.0' },
        scripts: { dev: 'ts-node src/index.ts' },
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

    const orchestratorPattern = type === 'multi-agent'
        ? `
import type { AgentProfile } from '@backendkit-labs/agent-core';
import { SPECIALIST_A_PROFILE } from './agents/specialist-a';
export const ORCHESTRATOR_PROFILE: AgentProfile = { id: 'orchestrator', name: 'Orchestrator', icon: '🤖', description: 'Main orchestrator', delegatesTo: ['specialist-a'], allowedTools: [], systemPrompt: 'You orchestrate.' };
`
        : `
import type { AgentProfile } from '@backendkit-labs/agent-core';
export const MY_AGENT_PROFILE: AgentProfile = { id: 'my-agent', name: 'My Agent', icon: '🤖', description: 'A single agent', delegatesTo: [], allowedTools: [], systemPrompt: 'You are helpful.' };
`;
    fs.writeFileSync(path.join(dir, 'src', 'agents', 'orchestrator.ts'), orchestratorPattern);

    const engineContent = `import type { CallbackTransport, AgentEngine } from '@backendkit-labs/agent-core';
import { AgentRegistry } from '@backendkit-labs/agent-core';
import { ORCHESTRATOR_PROFILE } from './agents/orchestrator';
import { SPECIALIST_A_PROFILE } from './agents/specialist-a';

// TODO: register more specialists
// TODO: register more tools

export function createEngine(transport: CallbackTransport): AgentEngine {
    const agents = new AgentRegistry({ orchestrator: ORCHESTRATOR_PROFILE });
    agents.register(SPECIALIST_A_PROFILE);
    // TODO: register more specialists

    const tools = { register: (t) => ({ register: (u) => ({}) }) };
    // TODO: register more tools

    return new AgentEngine({
        transport,
        agents,
    });
}
`;
    fs.writeFileSync(path.join(dir, 'src', 'engine.ts'), engineContent);

    return dir;
}

// ── Suite 1: detectProject ────────────────────────────────────────────────────

console.log('\n─── Suite 1: detectProject ───────────────────────────────────');

{
    const dir = createFakeProject('multi-agent');
    const info = detectProject(dir);

    check('returns non-null for valid project', info !== null);
    check('architecture = multi-agent', info?.architecture === 'multi-agent');
    check('engineFnName = createEngine', info?.engineFnName === 'createEngine');
    check('engineFile points to src/engine.ts', info?.engineFile.endsWith('engine.ts'));
    check('pkgFile points to package.json', info?.pkgFile.endsWith('package.json'));

    // Non-project directory
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-empty-'));
    fs.writeFileSync(path.join(emptyDir, 'package.json'), JSON.stringify({ name: 'other' }));
    check('returns null for non-bk-project', detectProject(emptyDir) === null);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
}

// ── Suite 2: add server ───────────────────────────────────────────────────────

console.log('\n─── Suite 2: add server ──────────────────────────────────────');

{
    const dir = createFakeProject();
    const info = detectProject(dir);

    addServer(info, ['--port', '4000', '--name', 'my-mcp']);

    const serverFile = path.join(dir, 'src', 'server.ts');
    check('src/server.ts created', fs.existsSync(serverFile));
    check('uses detected engineFnName', fileContains(serverFile, 'createEngine'));
    check('imports AgentMCPServer', fileContains(serverFile, 'AgentMCPServer'));
    check('uses port 4000', fileContains(serverFile, '4000'));
    check('uses name my-mcp', fileContains(serverFile, 'my-mcp'));

    const pkg = JSON.parse(fs.readFileSync(info.pkgFile, 'utf-8'));
    check('package.json has mcp-server dep', '@backendkit-labs/mcp-server' in pkg.dependencies);
    check('package.json has server script', 'server' in pkg.scripts);

    // Idempotency: second call should fail (server.ts already exists)
    let threw = false;
    const exit = process.exit;
    process.exit = () => { threw = true; throw new Error('exit'); };
    try { addServer(info, []); } catch (_) {}
    process.exit = exit;
    check('second add server exits with error', threw);

    fs.rmSync(dir, { recursive: true, force: true });
}

// ── Suite 3: add specialist ───────────────────────────────────────────────────

console.log('\n─── Suite 3: add specialist ──────────────────────────────────');

{
    const dir = createFakeProject();
    const info = detectProject(dir);

    addSpecialist(info, ['data-analyst']);

    const agentFile = path.join(dir, 'src', 'agents', 'data-analyst.ts');
    check('src/agents/data-analyst.ts created', fs.existsSync(agentFile));
    check('defines DATA_ANALYST_PROFILE', fileContains(agentFile, 'DATA_ANALYST_PROFILE'));
    check('engine.ts patched with import', fileContains(info.engineFile, `from './agents/data-analyst'`));
    check('engine.ts patched with register', fileContains(info.engineFile, 'DATA_ANALYST_PROFILE'));

    // Second add of the same name should exit
    let threw = false;
    const exit = process.exit;
    process.exit = () => { threw = true; throw new Error('exit'); };
    try { addSpecialist(info, ['data-analyst']); } catch (_) {}
    process.exit = exit;
    check('duplicate specialist exits with error', threw);

    fs.rmSync(dir, { recursive: true, force: true });
}

// ── Suite 4: add tools ────────────────────────────────────────────────────────

console.log('\n─── Suite 4: add tools ───────────────────────────────────────');

{
    const dir = createFakeProject();
    const info = detectProject(dir);

    addTools(info, ['github']);

    const toolsFile = path.join(dir, 'src', 'tools', 'github-tools.ts');
    check('src/tools/github-tools.ts created', fs.existsSync(toolsFile));
    check('defines githubAction', fileContains(toolsFile, 'githubAction'));
    check('defines githubQuery', fileContains(toolsFile, 'githubQuery'));
    check('engine.ts patched with import', fileContains(info.engineFile, `from './tools/github-tools'`));
    check('engine.ts patched with register', fileContains(info.engineFile, 'githubAction'));

    // kebab-case domain → camelCase
    const dir2 = createFakeProject();
    const info2 = detectProject(dir2);
    addTools(info2, ['my-domain']);
    const toolsFile2 = path.join(dir2, 'src', 'tools', 'my-domain-tools.ts');
    check('kebab domain creates correct file', fs.existsSync(toolsFile2));
    check('camelCase: myDomainAction', fileContains(toolsFile2, 'myDomainAction'));

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
}

// ── Suite 5: add mcp-client ───────────────────────────────────────────────────

console.log('\n─── Suite 5: add mcp-client ──────────────────────────────────');

{
    const dir = createFakeProject();
    const info = detectProject(dir);

    addMcpClient(info, ['http://localhost:3001/mcp', '--name', 'billing']);

    check('engine.ts has mcpServers', fileContains(info.engineFile, 'mcpServers'));
    check('entry has billing name', fileContains(info.engineFile, `name: 'billing'`));
    check('entry has url', fileContains(info.engineFile, 'http://localhost:3001/mcp'));

    // Second add of same URL should be idempotent (no duplicate)
    const before = fs.readFileSync(info.engineFile, 'utf-8');
    addMcpClient(info, ['http://localhost:3001/mcp', '--name', 'billing']);
    const after = fs.readFileSync(info.engineFile, 'utf-8');
    check('second add of same url is idempotent', before === after);

    // Add a second distinct server
    addMcpClient(info, ['http://localhost:4000/mcp', '--name', 'search']);
    check('second distinct server appended', fileContains(info.engineFile, `name: 'search'`));

    fs.rmSync(dir, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────────────────────');
if (failures === 0) {
    console.log(`\n${PASS}  All checks passed.\n`);
} else {
    console.log(`\n${FAIL}  ${failures} check(s) failed.\n`);
    process.exit(1);
}
