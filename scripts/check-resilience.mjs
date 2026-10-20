// Politica del repo: los reintentos usan @backendkit-labs/retry, no bucles propios.
// Heuristica: un bucle `for` sobre intentos/reintentos en un archivo que tambien usa setTimeout/sleep.
// Los timers de AbortController (timeouts) no se marcan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'test-projects', 'templates']);
const RETRY_LOOP = /for\s*\(\s*(?:let|var)\s+\w+\s*=\s*\d+\s*;\s*\w+\s*<=?\s*[\w.]*(?:retries|retry|attempts?|maxAttempts|MAX_RETRIES)[\w.]*/i;
const SLEEPS = /setTimeout\s*\(|\bsleep\s*\(/;

const hits = [];
function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (!SKIP_DIRS.has(name)) walk(p);
        } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) {
            const src = readFileSync(p, 'utf8');
            if (RETRY_LOOP.test(src) && SLEEPS.test(src)) hits.push(p);
        }
    }
}
ROOTS.forEach(walk);

if (hits.length) {
    console.error('check-resilience: reintentos manuales (usar @backendkit-labs/retry):\n  ' + hits.join('\n  '));
    process.exit(1);
}
console.log('check-resilience: ok');
