// A/B for the TECHNICAL skill `bk-resilience` — does it make the backend agent use the
// real @backendkit-labs resilience libs instead of hand-rolled loops / third-party libs?
// Both arms run under defaultAgent: 'backend' (correct profile). Skill is the only variable.
// Requires DEEPSEEK_API_KEY. Run: node ab-resilience.mjs

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport }  from '@backendkit-labs/agent-core';
import { loadBackendSkills }  from './backend-mcp/dist/load-skills.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

const PROMPT = [
    'Implement a TypeScript module `src/payment-client.ts` that calls an external payment HTTP API',
    '(POST https://payments.example.com/charge) which is known to be flaky and occasionally slow.',
    'The calls MUST be fault-tolerant: retry transient failures with backoff, fail fast when the',
    'upstream is consistently down, and cap concurrency so a slow upstream cannot exhaust resources.',
    'Write the source file(s) with write_file. Do NOT run install or build commands.',
].join('\n');

function score(text) {
    const t = text.toLowerCase();
    const usesBkRetry   = /@backendkit-labs\/retry/.test(t);
    const usesBkCircuit = /@backendkit-labs\/circuit-breaker/.test(t);
    const usesBkBulkhead= /@backendkit-labs\/bulkhead/.test(t);
    const handRolled    = /p-retry|axios-retry|opossum|cockatiel/.test(t)
                       || /for\s*\([^)]*attempt|while\s*\([^)]*retr|settimeout\([^)]*backoff/.test(t);
    return {
        'uses @backendkit-labs/retry':          usesBkRetry,
        'uses @backendkit-labs/circuit-breaker': usesBkCircuit,
        'uses @backendkit-labs/bulkhead':        usesBkBulkhead,
        'avoids hand-rolled / 3rd-party':        !handRolled,
        bkTotal: [usesBkRetry, usesBkCircuit, usesBkBulkhead].filter(Boolean).length,
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
            defaultProvider: 'deepseek', defaultAgent: 'backend',
            transport, workingDir, disablePersistence: true, maxIterations: 30, extraSkills,
        });
        engine.run(PROMPT).catch(reject);
    });
}

function corpusOf(root, output) {
    const files = [];
    const walk = (d) => { for (const e of readdirSync(d)) { const f = path.join(d, e);
        if (statSync(f).isDirectory()) { if (e !== 'node_modules') walk(f); } else files.push(f); } };
    try { walk(path.join(root, 'src')); } catch {}
    return { files, text: output + '\n' + files.map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n') };
}

async function arm(label, extraSkills) {
    const root = mkdtempSync(path.join(tmpdir(), 'res-ab-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'res', type: 'module' }, null, 2));
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
    const t0 = Date.now();
    const output = await runEngine(root, extraSkills);
    const { files, text } = corpusOf(root, output);
    const sc = score(text);
    console.log(`\n──────── ${label} (skills: ${extraSkills.map(s => s.name).join(',') || 'none'}) ────────`);
    console.log(`  files: ${files.map(f => path.basename(f)).join(', ')}`);
    for (const [k, v] of Object.entries(sc)) if (k !== 'bkTotal') console.log(`  ${v ? '✓' : '✗'} ${k}`);
    console.log(`  bk-resilience libs used: ${sc.bkTotal}/3   (${Math.round((Date.now() - t0) / 1000)}s)`);
    rmSync(root, { recursive: true, force: true });
    return sc.bkTotal;
}

const skill = loadBackendSkills().filter(s => s.name === 'bk-resilience');
console.log(`Skill under test: ${skill.map(s => s.name).join(', ') || 'NONE FOUND'}`);

const on  = await arm('A · skill ON',  skill);
const off = await arm('B · skill OFF', []);

console.log('\n════════ RESULT ════════');
console.log(`A (skill ON):  ${on}/3 bk libs`);
console.log(`B (skill OFF): ${off}/3 bk libs`);
console.log(on > off
    ? '✓ IMPACT CONFIRMED — the technical skill made the agent adopt the @backendkit-labs resilience stack.'
    : on === off ? '≈ no difference.' : '✗ unexpected regression.');
