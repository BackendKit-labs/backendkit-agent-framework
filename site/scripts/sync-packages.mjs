// The package reference pages are the READMEs of the packages, copied at build time: one source, no drift.
// Relative links are rewritten (to the other package pages, or to GitHub); the first H1 becomes the page title.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'src', 'content', 'docs', 'packages');
const GITHUB = 'https://github.com/BackendKit-labs/backendkit-agent-framework';
const BASE = '/backendkit-agent-framework';

// Published packages, in the order a reader meets them.
const ORDER = ['core', 'providers', 'testkit', 'flow-queue', 'enterprise', 'coding', 'sandbox', 'agent-protocol', 'web', 'web-ui', 'mcp-server', 'mcp-connectors', 'otel', 'document-extract', 'aval-tools', 'create-bk-agent'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const dirs = new Set(readdirSync(join(root, 'packages')).filter(d => existsSync(join(root, 'packages', d, 'README.md'))));

function rewrite(md, dir) {
  return md.replace(/\[([^\]]*)\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (m, text, target) => {
    const [pathPart, hash = ''] = target.split(/(?=#)/);
    const resolved = posix.normalize(posix.join('packages', dir, pathPart));
    const pkg = /^packages\/([^/]+)(?:\/README\.md)?\/?$/.exec(resolved);
    if (pkg && dirs.has(pkg[1])) return `[${text}](${BASE}/packages/${pkg[1]}/${hash})`;
    if (resolved.startsWith('..')) return text; // points outside the repository: keep the words, drop the link
    const isFile = /\.[A-Za-z0-9]+$/.test(resolved);
    return `[${text}](${GITHUB}/${isFile ? 'blob' : 'tree'}/master/${resolved}${hash})`;
  });
}

let n = 0;
for (const dir of [...ORDER, ...[...dirs].filter(d => !ORDER.includes(d) && d !== 'templates')]) {
  if (!dirs.has(dir)) continue;
  let md = readFileSync(join(root, 'packages', dir, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const h1 = /^# (.+)\n/.exec(md);
  const name = h1 ? h1[1].trim() : dir;
  md = md.replace(/^# .+\n+/, '');
  const firstPara = (md.split('\n\n').find(p => p.trim() && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|') && !p.startsWith('<')) ?? '').replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();
  const description = firstPara.length > 220 ? firstPara.slice(0, 217) + '...' : firstPara;
  const pj = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
  const meta = `<div class="pkg-meta"><code>npm i ${pj.name}</code> <a href="https://www.npmjs.com/package/${pj.name}">npm · v${pj.version}</a> <a href="${GITHUB}/tree/master/packages/${dir}">Source</a> <a href="${GITHUB}/blob/master/CHANGELOG.md">Changelog</a></div>`;
  const front = ['---', `title: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description || name)}`, 'sidebar:', `  order: ${ORDER.indexOf(dir) < 0 ? 99 : ORDER.indexOf(dir)}`, `  label: ${JSON.stringify(name.replace('@backendkit-labs/', ''))}`, `editUrl: ${GITHUB}/edit/master/packages/${dir}/README.md`, '---', '', meta, '', ''].join('\n');
  writeFileSync(join(out, `${dir}.md`), front + rewrite(md, dir));
  n++;
}
console.log(`sync-packages: ${n} package pages`);
