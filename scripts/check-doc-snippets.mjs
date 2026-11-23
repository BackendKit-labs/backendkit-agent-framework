#!/usr/bin/env node
/**
 * The examples in the documentation have to work (SPEC-0044 turned a rule into an error: an agent with no identity runs nothing, so an example
 * that does not give one fails when a reader copies it). Two checks:
 *
 *  1. LINT, every code block of every page and README: a block that builds an engine, a coding engine or an enterprise setup has to give it an
 *     identity (`agentIdentity`), and one that builds a capability server of agent-protocol has to give it a `gate`.
 *  2. COMPILE AND RUN, the pages listed in PAGES below: their blocks are written to a scratch project and compiled against the packages of this
 *     repository (so a renamed option or a removed export fails here), and the ones marked `run` are executed (offline, scripted model) and their
 *     output checked. A page enters this list when its blocks are meant to be copied whole.
 *
 * Needs the packages built (`npm run build`), as the compile step reads their `dist`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const root = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.doc-check']);
const GENERATED = join(root, 'site', 'src', 'content', 'docs', 'packages');   // copied from the READMEs by `npm run sync`: the README is the source

/** Pages compiled whole. `files[i]` names the i-th ts block (0-based); `run` lists the files to execute, with a text their output must contain. */
const PAGES = [
    {
        page: 'site/src/content/docs/start/first-agent.md',
        files: ['tool.ts', 'agent.ts', 'index.ts', 'real-model.ts'],
        run: [{ file: 'index.ts', expect: ['sunny in London', 'get_weather:true'] }],   // the tool ran: a denied call would still print the scripted answer
    },
];

const CONSTRUCTORS = /\b(createBaseEngine|new AgentEngine|createCodingEngine|createEnterpriseSetup)\(/;
const HAS_IDENTITY = /agentIdentity|requireAgentIdentity|localIdentityDefaults/;

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        if (p === GENERATED) continue;
        if (statSync(p).isDirectory()) yield* walk(p);
        else if (/\.(md|mdx)$/.test(name) && !/CHANGELOG/i.test(name)) yield p;
    }
}

function blocks(file) {
    const out = [];
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    let open = null;
    lines.forEach((line, i) => {
        const m = line.match(/^\s*```(\w*)/);
        if (!m) { if (open) open.code.push(line); return; }
        if (!open) { open = { lang: m[1], line: i + 1, code: [] }; return; }
        out.push({ lang: open.lang, line: open.line, code: open.code.join('\n') });
        open = null;
    });
    return out;
}

const isTs = (lang) => /^(ts|typescript|tsx)$/.test(lang);
const problems = [];

// ── 1. Lint ──────────────────────────────────────────────────────────────────────────────────────────────────
let checked = 0;
for (const dir of ['packages', 'site/src/content/docs', 'docs/adr', 'examples']) {
    let files;
    try { files = [...walk(join(root, dir))]; } catch { continue; }
    for (const file of files.filter(f => !/node_modules/.test(f))) {
        for (const b of blocks(file)) {
            if (!isTs(b.lang) && b.lang !== 'js' && b.lang !== 'javascript') continue;
            const where = `${relative(root, file)}:${b.line}`;
            if (CONSTRUCTORS.test(b.code)) {
                checked++;
                if (!HAS_IDENTITY.test(b.code)) problems.push(`${where}: builds an engine with no identity (add agentIdentity and identity: { userId }). An agent with none runs nothing.`);
            }
            if (/from '@backendkit-labs\/agent-protocol'/.test(b.code) && /new AgentServer\(/.test(b.code) && !/\bgate\b|allowUngated/.test(b.code)) {
                problems.push(`${where}: builds a capability server with no gate (add gate: capabilityIdentityGate(...)). A server with none runs nothing.`);
            }
        }
    }
}
{
    const readme = join(root, 'README.md');
    for (const b of blocks(readme)) {
        if ((isTs(b.lang) || !b.lang) && CONSTRUCTORS.test(b.code)) { checked++; if (!HAS_IDENTITY.test(b.code)) problems.push(`README.md:${b.line}: builds an engine with no identity.`); }
    }
}
console.log(`doc snippets: ${checked} blocks that build an engine checked for identity`);

// ── 2. Compile and run ───────────────────────────────────────────────────────────────────────────────────────
const scratch = join(root, '.doc-check');
rmSync(scratch, { recursive: true, force: true });
try {
    for (const spec of PAGES) {
        const dir = join(scratch, basename(spec.page).replace(/\W+/g, '-'));
        mkdirSync(dir, { recursive: true });
        const ts = blocks(join(root, spec.page)).filter(b => isTs(b.lang));
        if (ts.length !== spec.files.length) {
            problems.push(`${spec.page}: it has ${ts.length} ts blocks and the check expects ${spec.files.length}; update PAGES in scripts/check-doc-snippets.mjs`);
            continue;
        }
        ts.forEach((b, i) => writeFileSync(join(dir, spec.files[i]), b.code + '\n'));
        writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
            compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: true, skipLibCheck: true, esModuleInterop: true, outDir: 'out', types: ['node'] },
            include: ['*.ts'],
        }));
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
        const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
        try {
            execFileSync(process.execPath, [tsc, '-p', dir], { stdio: 'pipe', encoding: 'utf8' });
            console.log(`doc snippets: ${spec.page} compiles (${spec.files.length} files)`);
        } catch (err) {
            problems.push(`${spec.page}: does not compile\n${String(err.stdout || err.message).trim().split('\n').slice(0, 12).map(l => '    ' + l).join('\n')}`);
            continue;
        }
        // Node's ESM wants the extension in a relative import; the page, written for a bundler or tsx, does not have it.
        for (const f of readdirSync(join(dir, 'out')).filter(n => n.endsWith('.js'))) {
            const p = join(dir, 'out', f);
            writeFileSync(p, readFileSync(p, 'utf8').replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, b, c) => (/\.\w+$/.test(b) ? m : `${a}${b}.js${c}`)));
        }
        writeFileSync(join(dir, 'out', 'package.json'), JSON.stringify({ type: 'module' }));
        for (const r of spec.run ?? []) {
            try {
                const output = execFileSync(process.execPath, [join(dir, 'out', r.file.replace(/\.ts$/, '.js'))], { cwd: dir, stdio: 'pipe', encoding: 'utf8', timeout: 60_000 });
                const missing = [].concat(r.expect).filter(t => !output.includes(t));
                if (missing.length) problems.push(`${spec.page}: ${r.file} ran but its output does not contain "${missing.join('", "')}":\n    ${output.trim().split('\n').slice(0, 6).join('\n    ')}`);
                else console.log(`doc snippets: ${spec.page} ${r.file} runs and prints what the page says`);
            } catch (err) {
                problems.push(`${spec.page}: ${r.file} fails when run\n${String(err.stderr || err.message).trim().split('\n').slice(0, 10).map(l => '    ' + l).join('\n')}`);
            }
        }
    }
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

if (problems.length) {
    console.error(`\ndoc snippets: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
}
console.log('doc snippets: ok');
