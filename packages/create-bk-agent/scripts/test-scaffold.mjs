#!/usr/bin/env node
/**
 * A.6 — Scaffold regression tests
 * Runs scaffold() for each architecture × deployMode combination and verifies
 * that the expected files are present and the package.json scripts are correct.
 * No npm install is performed — only file generation is tested.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const require = createRequire(import.meta.url);
const { scaffold } = require('../dist/src/scaffold.js');

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

function files(dir) {
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = entry.name;
        if (entry.isDirectory()) {
            for (const sub of files(path.join(dir, rel))) {
                result.push(path.join(rel, sub));
            }
        } else {
            result.push(rel);
        }
    }
    return result;
}

function has(dir, relPath) {
    return fs.existsSync(path.join(dir, relPath));
}

function scripts(dir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return pkg.scripts ?? {};
}

function grep(dir, relPath, pattern) {
    const content = fs.readFileSync(path.join(dir, relPath), 'utf-8');
    return content.includes(pattern);
}

// ── Test runner ───────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-scaffold-'));

function run(label, choices, assertions) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${'─'.repeat(60)}`);

    const targetDir = path.join(tmpRoot, label.replace(/[^a-z0-9]/gi, '_'));
    try {
        scaffold(choices, targetDir);
    } catch (err) {
        console.log(`  ${FAIL} scaffold() threw: ${err.message}`);
        failures++;
        return;
    }

    assertions(targetDir);
}

// ── Test cases ────────────────────────────────────────────────────────────────

// A: multi-agent × repl — should match old domain-agent behavior
run('multi-agent × repl', {
    projectName:  'test-multi-repl',
    architecture: 'multi-agent',
    skillPacks:   [],
    deployMode:   'repl',
    provider:     'openai',
}, (dir) => {
    check('has engine.ts',            has(dir, 'src/engine.ts'));
    check('has orchestrator.ts',      has(dir, 'src/agents/orchestrator.ts'));
    check('has specialist-a.ts',      has(dir, 'src/agents/specialist-a.ts'));
    check('has specialist-b.ts',      has(dir, 'src/agents/specialist-b.ts'));
    check('has tools/example-tools',  has(dir, 'src/tools/example-tools.ts'));
    check('has index.ts (REPL)',      has(dir, 'src/index.ts'));
    check('no server.ts',            !has(dir, 'src/server.ts'));
    check('engine exports createEngine',  grep(dir, 'src/engine.ts', 'export function createEngine'));
    check('index imports createEngine',   grep(dir, 'src/index.ts',  'createEngine'));
    check('pkg.scripts.dev = index',      scripts(dir).dev?.includes('index.ts'));
    check('pkg.scripts.server absent',   !scripts(dir).server);
    check('package name patched',         JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).name === 'test-multi-repl');
    check('.env written',                 has(dir, '.env'));
    check('.env has LLM_API_KEY',         fs.readFileSync(path.join(dir, '.env'), 'utf-8').includes('OPENAI_API_KEY'));
});

// B: coding × repl — self-contained, should match old coding behavior
run('coding (self-contained)', {
    projectName:  'test-coding',
    architecture: 'coding',
    skillPacks:   [],
    deployMode:   'repl',
    provider:     'anthropic',
}, (dir) => {
    check('has src/index.ts',          has(dir, 'src/index.ts'));
    check('has AGENT.md',              has(dir, 'AGENT.md'));
    check('no src/server.ts',         !has(dir, 'src/server.ts'));
    check('no src/engine.ts',         !has(dir, 'src/engine.ts'));
    check('uses createCodingEngine',   grep(dir, 'src/index.ts', 'createCodingEngine'));
    check('pkg.scripts.dev = index',   scripts(dir).dev?.includes('index.ts'));
    check('.env has ANTHROPIC_API_KEY', fs.readFileSync(path.join(dir, '.env'), 'utf-8').includes('ANTHROPIC_API_KEY'));
});

// C: autonomous — self-contained
run('autonomous (self-contained)', {
    projectName:  'test-autonomous',
    architecture: 'autonomous',
    skillPacks:   [],
    deployMode:   undefined,
    provider:     'openai',
}, (dir) => {
    check('has src/index.ts',         has(dir, 'src/index.ts'));
    check('no src/engine.ts',        !has(dir, 'src/engine.ts'));
    check('no src/server.ts',        !has(dir, 'src/server.ts'));
    check('uses createAutonomousAgent', grep(dir, 'src/index.ts', 'createAutonomousAgent'));
});

// D: minimal — self-contained
run('minimal (self-contained)', {
    projectName:  'test-minimal',
    architecture: 'minimal',
    skillPacks:   [],
    deployMode:   undefined,
    provider:     'openai',
}, (dir) => {
    check('has src/index.ts',  has(dir, 'src/index.ts'));
    check('no engine.ts',     !has(dir, 'src/engine.ts'));
    check('no server.ts',     !has(dir, 'src/server.ts'));
});

// E: single × mcp-http — NEW combination
run('single × mcp-http', {
    projectName:  'test-single-http',
    architecture: 'single',
    skillPacks:   [],
    deployMode:   'mcp-http',
    provider:     'deepseek',
}, (dir) => {
    check('has engine.ts',              has(dir, 'src/engine.ts'));
    check('has my-agent.ts',            has(dir, 'src/agents/my-agent.ts'));
    check('has server.ts',              has(dir, 'src/server.ts'));
    check('no index.ts (no REPL)',     !has(dir, 'src/index.ts'));
    check('no orchestrator',           !has(dir, 'src/agents/orchestrator.ts'));
    check('engine exports createEngine', grep(dir, 'src/engine.ts', 'export function createEngine'));
    check('server uses AgentMCPServer',  grep(dir, 'src/server.ts',  'AgentMCPServer'));
    check('server calls start()',        grep(dir, 'src/server.ts',  'server.start()'));
    check('server imports createEngine', grep(dir, 'src/server.ts',  'createEngine'));
    check('pkg.dev = server.ts',         scripts(dir).dev?.includes('server.ts'));
    check('pkg.server script absent',   !scripts(dir).server);
});

// F: multi-agent × hybrid — NEW combination
run('multi-agent × hybrid', {
    projectName:  'test-multi-hybrid',
    architecture: 'multi-agent',
    skillPacks:   [],
    deployMode:   'hybrid',
    provider:     'anthropic',
}, (dir) => {
    check('has engine.ts',          has(dir, 'src/engine.ts'));
    check('has orchestrator.ts',    has(dir, 'src/agents/orchestrator.ts'));
    check('has index.ts (REPL)',    has(dir, 'src/index.ts'));
    check('has server.ts (MCP)',    has(dir, 'src/server.ts'));
    check('index imports createEngine',  grep(dir, 'src/index.ts',  'createEngine'));
    check('server imports createEngine', grep(dir, 'src/server.ts', 'createEngine'));
    check('server uses AgentMCPServer',  grep(dir, 'src/server.ts', 'AgentMCPServer'));
    check('pkg.dev = index.ts',          scripts(dir).dev?.includes('index.ts'));
    check('pkg.server = server.ts',      scripts(dir).server?.includes('server.ts'));
});

// G: multi-agent × mcp-stdio
run('multi-agent × mcp-stdio', {
    projectName:  'test-multi-stdio',
    architecture: 'multi-agent',
    skillPacks:   [],
    deployMode:   'mcp-stdio',
    provider:     'anthropic',
}, (dir) => {
    check('has engine.ts',              has(dir, 'src/engine.ts'));
    check('has server.ts',              has(dir, 'src/server.ts'));
    check('no index.ts',               !has(dir, 'src/index.ts'));
    check('server calls startStdio()',  grep(dir, 'src/server.ts', 'startStdio'));
    check('pkg.dev = server.ts',        scripts(dir).dev?.includes('server.ts'));
});

// H: single × repl + skill packs
run('single × repl + node + go skill packs', {
    projectName:  'test-single-skills',
    architecture: 'single',
    skillPacks:   ['node', 'go'],
    deployMode:   'repl',
    provider:     'openai',
}, (dir) => {
    check('has engine.ts',          has(dir, 'src/engine.ts'));
    check('has index.ts',           has(dir, 'src/index.ts'));
    const engineContent = fs.readFileSync(path.join(dir, 'src/engine.ts'), 'utf-8');
    check('node skill hint injected',  engineContent.includes('Skill pack: node'));
    check('go skill hint injected',    engineContent.includes('Skill pack: go'));
});

// I: multi-agent × library
run('multi-agent × library', {
    projectName:  'test-multi-library',
    architecture: 'multi-agent',
    skillPacks:   [],
    deployMode:   'library',
    provider:     'openai',
}, (dir) => {
    check('has engine.ts',      has(dir, 'src/engine.ts'));
    check('no index.ts',       !has(dir, 'src/index.ts'));
    check('no server.ts',      !has(dir, 'src/server.ts'));
    check('pkg.dev absent',    !scripts(dir).dev);
    check('pkg.server absent', !scripts(dir).server);
    check('pkg.start absent',  !scripts(dir).start);
});

// ── Cleanup + summary ─────────────────────────────────────────────────────────

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${'═'.repeat(60)}`);
if (failures === 0) {
    console.log(`\x1b[32m  All checks passed.\x1b[0m`);
} else {
    console.log(`\x1b[31m  ${failures} check(s) failed.\x1b[0m`);
    process.exit(1);
}
console.log(`${'═'.repeat(60)}\n`);
