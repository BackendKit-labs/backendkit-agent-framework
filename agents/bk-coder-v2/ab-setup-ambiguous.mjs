// Sharper A/B: an AMBIGUOUS "set up the project" task in a NEUTRAL empty dir.
// No explicit "frontend/backend", no project context to nudge — so the PROFILE
// identity decides what gets scaffolded. Reproduces the agent-cloud failure mode:
//   A) defaultAgent 'frontend' → expect a Next.js/React scaffold
//   B) defaultAgent 'backend'  → expect a NestJS/Express scaffold (the bug)
// Requires DEEPSEEK_API_KEY. Run: node ab-setup-ambiguous.mjs

import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport }  from '@backendkit-labs/agent-core';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

// Ambiguous: "dashboard web app" implies UI, but no explicit frontend/backend word
// and no instruction about what NOT to build.
const PROMPT = [
    'Set up the project foundation for an "agent-management dashboard" web app.',
    'Create the initial project structure, configuration files, and the entry point.',
    'Use write_file for each file. Do NOT run install or build commands.',
].join('\n');

function classify(text) {
    const t = text.toLowerCase();
    const frontend = /from ['"]react['"]|from ['"]next|next\.config|\.tsx\b|usestate|useeffect|app\/(page|layout)|"next"|"react"/.test(t);
    const backend  = /@nestjs|nestfactory|nest-cli|@controller|@injectable|@module|express\(\)|app\.listen\(|"@nestjs|fastify/.test(t);
    const kind = frontend && backend ? 'MIXED' : frontend ? 'frontend' : backend ? 'backend' : 'unclear';
    return { frontend, backend, kind };
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
    try { walk(root); } catch {}
    return { files, text: output + '\n' + files.map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n') };
}

async function arm(label, defaultAgent) {
    const root = mkdtempSync(path.join(tmpdir(), 'setup-ab-'));  // NEUTRAL: empty, no package.json
    const t0 = Date.now();
    const output = await runEngine(root, defaultAgent);
    const { files, text } = corpus(root, output);
    const c = classify(text);
    console.log(`\n──────── ${label} (defaultAgent: ${defaultAgent}) ────────`);
    console.log(`  files: ${files.map(f => f.replace(root, '').replace(/^[\\/]/, '')).join(', ') || '(none)'}`);
    console.log(`  scaffolded: ${c.kind}${c.kind === 'MIXED' ? '  ⚠ front+back mezclados (= agent-cloud)' : ''}`);
    console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
    rmSync(root, { recursive: true, force: true });
    return c.kind;
}

const a = await arm('A · frontend profile', 'frontend');
const b = await arm('B · backend profile',  'backend');

console.log('\n════════ RESULT ════════');
console.log(`A (frontend profile): ${a}`);
console.log(`B (backend profile):  ${b}`);
console.log(
    a === 'frontend' && (b === 'backend' || b === 'MIXED')
        ? '✓ PROFILE DECIDES — ambiguous setup splits by identity: frontend→UI, backend→server (the agent-cloud drift). The domain routing is what prevents it.'
    : a === b
        ? '≈ both profiles scaffolded the same — identity did not drive the choice here.'
        : `↔ frontend→${a}, backend→${b} — partial signal.`);
