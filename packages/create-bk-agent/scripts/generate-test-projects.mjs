#!/usr/bin/env node
/**
 * Genera un proyecto scaffoldeado por cada combinación arquitectura × deploy mode.
 * Output: packages/create-bk-agent/test-projects/<nombre>/
 *
 * Uso: node scripts/generate-test-projects.mjs
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { scaffold } = require('../dist/src/scaffold.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-projects');

// ── Limpia y recrea el directorio de salida ───────────────────────────────────
if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Combinaciones a generar ───────────────────────────────────────────────────

const CASES = [
    // self-contained
    { projectName: 'coding',                    architecture: 'coding',      skillPacks: [],       deployMode: undefined,    provider: 'anthropic' },
    { projectName: 'autonomous',                architecture: 'autonomous',  skillPacks: [],       deployMode: undefined,    provider: 'anthropic' },
    { projectName: 'minimal',                   architecture: 'minimal',     skillPacks: [],       deployMode: undefined,    provider: 'anthropic' },

    // single × all deploy modes
    { projectName: 'single-repl',               architecture: 'single',      skillPacks: ['node'], deployMode: 'repl',       provider: 'anthropic' },
    { projectName: 'single-mcp-http',           architecture: 'single',      skillPacks: ['node'], deployMode: 'mcp-http',   provider: 'anthropic' },
    { projectName: 'single-mcp-stdio',          architecture: 'single',      skillPacks: ['node'], deployMode: 'mcp-stdio',  provider: 'anthropic' },
    { projectName: 'single-hybrid',             architecture: 'single',      skillPacks: ['node'], deployMode: 'hybrid',     provider: 'anthropic' },
    { projectName: 'single-library',            architecture: 'single',      skillPacks: [],       deployMode: 'library',    provider: 'anthropic' },

    // multi-agent × all deploy modes
    { projectName: 'multi-repl',                architecture: 'multi-agent', skillPacks: ['node'], deployMode: 'repl',       provider: 'anthropic' },
    { projectName: 'multi-mcp-http',            architecture: 'multi-agent', skillPacks: ['node'], deployMode: 'mcp-http',   provider: 'anthropic' },
    { projectName: 'multi-mcp-stdio',           architecture: 'multi-agent', skillPacks: ['node'], deployMode: 'mcp-stdio',  provider: 'anthropic' },
    { projectName: 'multi-hybrid',              architecture: 'multi-agent', skillPacks: ['node'], deployMode: 'hybrid',     provider: 'anthropic' },
    { projectName: 'multi-library',             architecture: 'multi-agent', skillPacks: [],       deployMode: 'library',    provider: 'anthropic' },

    // providers alternativos (single-repl como base)
    { projectName: 'single-openai',             architecture: 'single',      skillPacks: [],       deployMode: 'repl',       provider: 'openai'    },
    { projectName: 'single-deepseek',           architecture: 'single',      skillPacks: [],       deployMode: 'repl',       provider: 'deepseek'  },
    { projectName: 'single-ollama',             architecture: 'single',      skillPacks: [],       deployMode: 'repl',       provider: 'ollama'    },

    // skill packs múltiples
    { projectName: 'multi-skills-all',          architecture: 'multi-agent', skillPacks: ['node','python','go','docker'], deployMode: 'repl', provider: 'anthropic' },
];

// ── Genera cada proyecto ──────────────────────────────────────────────────────

let ok = 0;
let fail = 0;

for (const choices of CASES) {
    const targetDir = path.join(OUTPUT_DIR, choices.projectName);
    process.stdout.write(`  Scaffolding  ${choices.projectName.padEnd(28)}`);
    try {
        scaffold(choices, targetDir);
        console.log('\x1b[32m✓\x1b[0m');
        ok++;
    } catch (err) {
        console.log(`\x1b[31m✗  ${err.message}\x1b[0m`);
        fail++;
    }
}

// ── Índice de lo generado ─────────────────────────────────────────────────────

console.log(`\n  Generated ${ok} projects${fail ? `, ${fail} failed` : ''} → ${OUTPUT_DIR}\n`);

// Árbol de primer nivel de cada proyecto
for (const choices of CASES) {
    const dir = path.join(OUTPUT_DIR, choices.projectName);
    if (!fs.existsSync(dir)) continue;

    const srcDir = path.join(dir, 'src');
    const srcEntries = fs.existsSync(srcDir)
        ? fs.readdirSync(srcDir, { withFileTypes: true })
              .map(e => e.isDirectory() ? e.name + '/' : e.name)
              .join('  ')
        : '(no src)';

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    const scripts = Object.keys(pkg.scripts ?? {}).join(', ');

    console.log(`  \x1b[36m${choices.projectName}\x1b[0m`);
    console.log(`    src/  ${srcEntries}`);
    console.log(`    scripts: ${scripts}`);
    console.log();
}

if (fail > 0) process.exit(1);
