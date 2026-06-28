// A/B impact test: does the rest-resource skill actually shape the agent's output?
// Runs the SAME implement prompt through the real coding engine twice —
//   A) extraSkills = [rest-resource]   (skill ON)
//   B) extraSkills = []                (skill OFF, same 'general' base agent)
// then scores each output on the playbook markers the skill prescribes.
//
// Faithful to the MCP path: same createCodingEngine + engine.run() the *-mcp servers use.
// Requires DEEPSEEK_API_KEY in env. Run: node ab-skill-impact.mjs

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport }  from '@backendkit-labs/agent-core';
import { loadBackendSkills }  from './backend-mcp/dist/load-skills.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

const PROMPT = [
    'Implement a REST API for a "product" resource in TypeScript (Express).',
    'Endpoints: list, get by id, create, update, delete.',
    'A product has: id, name, price, stock.',
    'Write the source files under src/. Use write_file for each file.',
    'Do NOT run any install or build commands — just write the source code.',
    'Keep it focused; no README, no package.json.',
].join('\n');

// Playbook markers the rest-resource skill prescribes.
function score(text) {
    const t = text.toLowerCase();
    const layering = /controller/.test(t) && /service/.test(t) && /(repository|repositor)/.test(t);
    const dto      = /(dto|zod|class-validator|schema\.parse|validate\()/.test(t);
    const errors   = /(errorfilter|error-handler|errorhandler|notfounderror|status\(404\)|httpexception|error middleware|maperror)/.test(t);
    return {
        layering, dto, errors,
        total: [layering, dto, errors].filter(Boolean).length,
    };
}

function runEngine(workingDir, extraSkills) {
    return new Promise((resolve, reject) => {
        let output = '';
        const transport = new CallbackTransport((e) => {
            if (e.type === 'token') output += e.content;
            if (e.type === 'done')  resolve(output);
            if (e.type === 'error') reject(new Error(e.message));
        });
        const engine = createCodingEngine({
            providers: { deepseek: { apiKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' } },
            defaultProvider: 'deepseek',
            defaultAgent: 'backend',   // corrected: measure the skill on top of the REAL specialist base
            transport,
            workingDir,
            disablePersistence: true,
            maxIterations: 30,
            extraSkills,
        });
        engine.run(PROMPT).catch(reject);
    });
}

function collectWritten(dir) {
    const out = [];
    const walk = (d) => {
        for (const e of readdirSync(d)) {
            const full = path.join(d, e);
            if (statSync(full).isDirectory()) { if (e !== 'node_modules') walk(full); }
            else out.push(full);
        }
    };
    try { walk(dir); } catch {}
    return out;
}

function setupProject() {
    const root = mkdtempSync(path.join(tmpdir(), 'skill-ab-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    // stack indicators so detectProjectStack → node/typescript
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ab', type: 'module' }, null, 2));
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
    return root;
}

async function arm(label, extraSkills) {
    const root = setupProject();
    console.log(`\n──────── ${label} (skills: ${extraSkills.map(s => s.name).join(',') || 'none'}) ────────`);
    const t0 = Date.now();
    const output = await runEngine(root, extraSkills);
    const files  = collectWritten(path.join(root, 'src'));
    const corpus = output + '\n' + files.map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');
    const sc = score(corpus);
    console.log(`  files written: ${files.length} (${files.map(f => path.basename(f)).join(', ')})`);
    console.log(`  layering(controller+service+repository): ${sc.layering ? '✓' : '✗'}`);
    console.log(`  DTO/schema validation:                   ${sc.dto ? '✓' : '✗'}`);
    console.log(`  centralized error mapping:               ${sc.errors ? '✓' : '✗'}`);
    console.log(`  score: ${sc.total}/3   (${Math.round((Date.now() - t0) / 1000)}s)`);
    rmSync(root, { recursive: true, force: true });
    return sc.total;
}

const skill = loadBackendSkills();
console.log(`Loaded skill: ${skill.map(s => s.name).join(', ')}`);

const withSkill    = await arm('A · skill ON',  skill);
const withoutSkill = await arm('B · skill OFF', []);

console.log('\n════════ RESULT ════════');
console.log(`A (skill ON):  ${withSkill}/3`);
console.log(`B (skill OFF): ${withoutSkill}/3`);
console.log(withSkill > withoutSkill
    ? '✓ IMPACT CONFIRMED — the skill raised playbook adherence.'
    : withSkill === withoutSkill
        ? '≈ NO MEASURABLE DIFFERENCE on these markers (base agent already strong, or weak triggers).'
        : '✗ UNEXPECTED — skill OFF scored higher; investigate.');
