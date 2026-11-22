// Despues de subir versiones en los package.json: regenera package-lock.json como se hace a mano.
//   1. `npm install --ignore-scripts` dos veces (la primera puede dejar el arbol a medias),
//   2. revierte packages/codemod/bin/codemod.js si npm lo deja marcado sin cambio de contenido (modo o fin de linea en Windows),
//   3. muestra que el lockfile solo cambio en versiones.
//   node scripts/refresh-lockfile.mjs
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (cmd) => spawnSync(cmd, { cwd: root, encoding: 'utf8', shell: true });

for (let i = 1; i <= 2; i++) {
    const r = run('npm install --ignore-scripts');
    if (r.status !== 0) { console.error(`npm install (${i}/2) fallo:\n${r.stderr || r.stdout}`); process.exit(1); }
    console.log(`npm install ${i}/2 ok`);
}

// codemod.js: npm leaves it flagged as modified on Windows (the mode or the line endings, never the content). Revert it only when
// there is no change of content at all.
const flagged = run('git status --porcelain -- packages/codemod/bin/codemod.js').stdout.trim();
const content = run('git diff -w --ignore-cr-at-eol --numstat -- packages/codemod/bin/codemod.js').stdout.trim();
if (flagged && !content) {
    run('git checkout -- packages/codemod/bin/codemod.js');
    console.log('codemod.js: marcado como modificado sin cambio de contenido, revertido');
}

const lock = run('git diff -U0 -- package-lock.json').stdout
    .split('\n').filter(l => /^[+-]\s/.test(l) && !/^[+-]\s+"version":/.test(l) && !/^(\+\+\+|---)/.test(l));
if (lock.length > 0) {
    console.log('OJO: el lockfile cambia algo mas que versiones:');
    for (const l of lock.slice(0, 20)) console.log(`  ${l}`);
    process.exitCode = 2;
} else {
    console.log('package-lock.json: solo cambian versiones');
}
