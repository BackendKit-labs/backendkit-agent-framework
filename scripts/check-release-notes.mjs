// Falla si un paquete tiene una version que aun no esta en npm y el CHANGELOG no la documenta.
// Es el caso de un PR de bump que olvida su seccion: el CHANGELOG es una tabla con una fila `| `<paquete>` | <version> |` por paquete publicado.
// Una version que ya esta en npm no se comprueba (ya se publico; el CHANGELOG de entonces es historia).
//   node scripts/check-release-notes.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const dirs = readdirSync(join(root, 'packages')).filter(d => existsSync(join(root, 'packages', d, 'package.json')));

const problems = [];
for (const d of dirs) {
    const pkg = JSON.parse(readFileSync(join(root, 'packages', d, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    const view = spawnSync(`npm view ${pkg.name}@${pkg.version} version --prefer-online`, { encoding: 'utf8', shell: true });
    if (view.stdout.trim() === pkg.version) continue;                          // already published
    const short = pkg.name.replace(/^@[^/]+\//, '');
    const row = new RegExp(`\\|\\s*\`${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`\\s*\\|\\s*${pkg.version.replace(/\./g, '\\.')}\\s*\\|`);
    if (!row.test(changelog)) problems.push(`${pkg.name}@${pkg.version} no esta en npm y el CHANGELOG no tiene su fila: | \`${short}\` | ${pkg.version} |`);
    else console.log(`${pkg.name}@${pkg.version}: por publicar, documentada en el CHANGELOG`);
}
if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
}
console.log('release-notes: ok');
