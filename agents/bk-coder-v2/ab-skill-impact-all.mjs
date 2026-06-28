// A/B impact test extended to qa / security / infra.
// For each agent: run the same domain task through the real coding engine twice
// (extraSkills = [domain skill]  vs  []), score the output on the skill's playbook markers.
// Faithful to the MCP path (createCodingEngine + engine.run). Requires DEEPSEEK_API_KEY.
// Run: node ab-skill-impact-all.mjs

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport }  from '@backendkit-labs/agent-core';
import { loadQaSkills }       from './qa-mcp/dist/load-skills.js';
import { loadSecuritySkills } from './security-mcp/dist/load-skills.js';
import { loadInfraSkills }    from './infra-mcp/dist/load-skills.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set'); process.exit(2); }

// Seeded source used by qa (validate) and security (audit) — contains a deliberate
// spec gap (no input validation) and a deliberate vuln (hardcoded secret + string-concat SQL).
const SEED_SRC = `import { Router } from 'express';
const router = Router();
const API_SECRET = 'sk_live_hardcoded_1234567890';   // secret in code
const db = { query: (s) => Promise.resolve([]) };

router.get('/users/:id', async (req, res) => {
  const rows = await db.query('SELECT * FROM users WHERE id = ' + req.params.id); // SQL concat
  res.json(rows[0]);
});
router.post('/users', async (req, res) => {
  // no validation of req.body
  await db.query('INSERT INTO users (name) VALUES (' + req.body.name + ')');
  res.status(201).json({ ok: true });
});
export default router;
`;

const AGENTS = {
    qa: {
        loader: loadQaSkills,
        seed: (root) => writeFileSync(path.join(root, 'src', 'users.ts'), SEED_SRC),
        prompt: [
            'Validate the implementation in src/users.ts against these spec criteria:',
            '  C1: All user inputs are validated before use.',
            '  C2: No SQL injection — queries are parameterized.',
            '  C3: GET /users/:id returns the user.',
            'Map each criterion to evidence, separate blocking from advisory findings,',
            'and end with one exact line: VERDICT: GO | VERDICT: NO_GO | VERDICT: CONDITIONAL.',
        ].join('\n'),
        markers: (t) => ({
            'verdict line': /verdict:\s*(go|no_go|conditional)/i.test(t),
            'criterion→evidence map': /(c1|c2|c3|criterion|criterio)/i.test(t) && /(evidence|evidencia|src\/|\.ts|line)/i.test(t),
            'blocking vs advisory': /(blocking|bloquea|advisory|severity|high|medium|low)/i.test(t),
        }),
    },
    security: {
        loader: loadSecuritySkills,
        seed: (root) => writeFileSync(path.join(root, 'src', 'users.ts'), SEED_SRC),
        prompt: [
            'Run a security review of src/users.ts. Report every vulnerability with a severity,',
            'a CWE id, the location, and a remediation. Check for hardcoded secrets and injection.',
            'End with one exact line: VERDICT: PASS | VERDICT: FAIL | VERDICT: CONDITIONAL.',
        ].join('\n'),
        markers: (t) => ({
            'verdict line': /verdict:\s*(pass|fail|conditional)/i.test(t),
            'CWE tagging': /cwe-\d+/i.test(t),
            'severity triage': /(critical|high|medium|low)/i.test(t),
        }),
    },
    infra: {
        loader: loadInfraSkills,
        seed: (root) => writeFileSync(path.join(root, 'package.json'),
            JSON.stringify({ name: 'svc', type: 'module', scripts: { start: 'node dist/index.js', build: 'tsc' } }, null, 2)),
        prompt: [
            'Generate the Dockerfile and a .dockerignore for this Node/TypeScript service.',
            'Use write_file. Do NOT run any commands.',
        ].join('\n'),
        markers: (t) => ({
            'multi-stage build': /from\s+\S+\s+as\s+\w+/i.test(t),
            'non-root USER': /user\s+(?!root)\w+/i.test(t),
            'HEALTHCHECK': /healthcheck/i.test(t),
            '.dockerignore': /dockerignore|node_modules/i.test(t),
        }),
    },
};

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
            defaultProvider: 'deepseek', transport, workingDir,
            disablePersistence: true, maxIterations: 30, extraSkills,
        });
        engine.run(extraSkills.__prompt).catch(reject);
    });
}

function collect(dir) {
    const out = [];
    const walk = (d) => { for (const e of readdirSync(d)) { const f = path.join(d, e);
        if (statSync(f).isDirectory()) { if (e !== 'node_modules') walk(f); } else out.push(f); } };
    try { walk(dir); } catch {}
    return out;
}

async function arm(cfg, label, skills) {
    const root = mkdtempSync(path.join(tmpdir(), 'skill-ab-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    cfg.seed(root);
    const ex = [...skills]; ex.__prompt = cfg.prompt;
    const t0 = Date.now();
    const output = await runEngine(root, ex);
    const corpus = output + '\n' + collect(root).map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');
    const m = cfg.markers(corpus);
    const total = Object.values(m).filter(Boolean).length;
    const max = Object.keys(m).length;
    console.log(`  ${label}: ${total}/${max}  (${Math.round((Date.now() - t0) / 1000)}s)  ` +
        Object.entries(m).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join('  '));
    rmSync(root, { recursive: true, force: true });
    return { total, max };
}

for (const [name, cfg] of Object.entries(AGENTS)) {
    const skill = cfg.loader();
    console.log(`\n──────── ${name}  (skill: ${skill.map(s => s.name).join(',')}) ────────`);
    const on  = await arm(cfg, 'A skill ON ', skill);
    const off = await arm(cfg, 'B skill OFF', []);
    const verdict = on.total > off.total ? '✓ IMPACT' : on.total === off.total ? '≈ no diff' : '✗ regression';
    console.log(`  → ${name}: ON ${on.total}/${on.max}  vs  OFF ${off.total}/${off.max}   ${verdict}`);
}
