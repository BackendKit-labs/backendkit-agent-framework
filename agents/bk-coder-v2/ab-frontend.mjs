// A/B that validates the agent-cloud fix: a FRONTEND-only task implemented by
//   A) defaultAgent 'frontend'  (the new specialist)   → should stay in the frontend lane
//   B) defaultAgent 'backend'   (what ran before)       → the failure mode (leaks backend)
// Same task, same engine — only the PROFILE differs. Requires DEEPSEEK_API_KEY.
// Run: node ab-frontend.mjs

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport }  from '@backendkit-labs/agent-core';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

// A frontend-only task, exactly the shape of agent-cloud's spec: build UI that
// consumes an EXISTING backend API. No backend should be written.
const PROMPT = [
    'Implement a dashboard page for an agent-management web app.',
    'Show metric cards (total agents, active agents, total projects) by consuming the EXISTING',
    'backend REST API at GET /api/director/metrics and GET /api/projects.',
    'The backend already exists — do NOT build it. Build the frontend only.',
    'Use write_file for each file. Do NOT run install or build commands.',
].join('\n');

function score(text) {
    const t = text.toLowerCase();
    const hasFrontend  = /\.(tsx|jsx)\b/.test(t) || /from ['"]react['"]/.test(t) || /from ['"]next/.test(t)
                      || /usestate|useeffect/.test(t) || /export default function/.test(t);
    const consumesApi  = (/fetch\(|axios/.test(t)) && /\/api\//.test(t);
    const backendLeak  = /@nestjs|@controller|@injectable|@entity|typeorm|createconnection|app\.listen\(|express\(\)|nestfactory/.test(t);
    return {
        'builds frontend (React/Next)': hasFrontend,
        'consumes existing API':        consumesApi,
        'no backend leakage':           !backendLeak,
        _leak: backendLeak,
        total: [hasFrontend, consumesApi, !backendLeak].filter(Boolean).length,
    };
}

function runEngine(workingDir, defaultAgent) {
    return new Promise((resolve, reject) => {
        let output = '';
        const transport = new CallbackTransport((e) => {
            if (e.type === 'token') output += e.content;
            if (e.type === 'done')  resolve(output);
            if (e.type === 'error') reject(new Error(e.message));
        });
        const engine = createCodingEngine({
            providers: { deepseek: { apiKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' } },
            defaultProvider: 'deepseek', defaultAgent,
            transport, workingDir, disablePersistence: true, maxIterations: 30,
        });
        engine.run(PROMPT).catch(reject);
    });
}

function corpus(root, output) {
    const files = [];
    const walk = (d) => { for (const e of readdirSync(d)) { const f = path.join(d, e);
        if (statSync(f).isDirectory()) { if (e !== 'node_modules') walk(f); } else files.push(f); } };
    try { walk(path.join(root, 'src')); } catch {}
    try { for (const e of readdirSync(root)) { const f = path.join(root, e); if (statSync(f).isFile()) files.push(f); } } catch {}
    return { files, text: output + '\n' + files.map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n') };
}

async function arm(label, defaultAgent) {
    const root = mkdtempSync(path.join(tmpdir(), 'fe-ab-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    // Realistic frontend project so stack detection = node/typescript
    writeFileSync(path.join(root, 'package.json'),
        JSON.stringify({ name: 'dash', type: 'module', dependencies: { next: '^15', react: '^19' } }, null, 2));
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve' } }, null, 2));
    const t0 = Date.now();
    const output = await runEngine(root, defaultAgent);
    const { files, text } = corpus(root, output);
    const sc = score(text);
    console.log(`\n──────── ${label} (defaultAgent: ${defaultAgent}) ────────`);
    console.log(`  files: ${files.map(f => path.basename(f)).join(', ') || '(none)'}`);
    for (const [k, v] of Object.entries(sc)) if (!k.startsWith('_') && k !== 'total') console.log(`  ${v ? '✓' : '✗'} ${k}`);
    if (sc._leak) console.log(`  ⚠ BACKEND LEAK detected (NestJS/Express/TypeORM/@Controller…)`);
    console.log(`  frontend-purity: ${sc.total}/3   (${Math.round((Date.now() - t0) / 1000)}s)`);
    rmSync(root, { recursive: true, force: true });
    return sc.total;
}

const a = await arm('A · NEW — frontend specialist', 'frontend');
const b = await arm('B · OLD — backend implements frontend', 'backend');

console.log('\n════════ RESULT ════════');
console.log(`A (frontend agent): ${a}/3`);
console.log(`B (backend agent):  ${b}/3`);
console.log(a > b
    ? '✓ FIX VALIDATED — the frontend profile keeps the agent in its lane; the backend profile drifts (the agent-cloud failure mode).'
    : a === b ? '≈ no difference on these markers.' : '✗ unexpected.');
