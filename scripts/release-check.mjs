// Antes de publicar: por cada paquete (directorio o nombre de carpeta bajo packages/) dice si su version ya esta en npm
// y si ya existe su tag git `<nombre>@<version>`. Sustituye a los `npm view` y `git tag -l` hechos a mano.
//   node scripts/release-check.mjs core providers        # esos paquetes
//   node scripts/release-check.mjs                       # todos los publicables
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const wanted = process.argv.slice(2).map(a => a.replace(/^packages[\/]/, '').replace(/[\/]$/, ''));
const dirs = readdirSync(join(root, 'packages')).filter(d => existsSync(join(root, 'packages', d, 'package.json')));

let problems = 0;
for (const d of dirs) {
    if (wanted.length > 0 && !wanted.includes(d)) continue;
    const pkg = JSON.parse(readFileSync(join(root, 'packages', d, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    const spec = `${pkg.name}@${pkg.version}`;
    const npm = spawnSync(`npm view ${spec} version --prefer-online`, { encoding: 'utf8', shell: true });
    const onNpm = npm.stdout.trim() === pkg.version;
    const shortName = pkg.name.replace(/^@[^/]+\//, '');
    const tag = spawnSync(`git tag -l ${shortName}@${pkg.version}`, { encoding: 'utf8', shell: true, cwd: root }).stdout.trim();
    const state = onNpm ? 'YA EN NPM' : 'libre en npm';
    console.log(`${spec.padEnd(52)} ${state.padEnd(14)} tag: ${tag ? 'existe' : 'no existe'}`);
    if (onNpm && !tag) { console.log(`  -> publicado sin tag: git tag ${shortName}@${pkg.version} <commit>`); problems++; }
}
if (problems > 0) process.exitCode = 1;
