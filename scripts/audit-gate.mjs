// Falla si `npm audit --omit=dev` reporta high/critical fuera de la lista de excepciones.
// Cada excepcion lleva motivo y fecha limite: pasada la fecha, vuelve a fallar.
import { spawnSync } from 'node:child_process';

const EXCEPTIONS = {
    'adm-zip': {
        reason: 'onnxruntime-node y @mintlify/cli lo fijan en 0.6.0 exacto; fix en 0.6.1 espera bump upstream',
        until: '2026-12-31',
    },
};

const res = spawnSync('npm audit --omit=dev --json', { encoding: 'utf8', shell: true });
let report;
try {
    report = JSON.parse(res.stdout);
} catch {
    console.error('audit-gate: no se pudo leer la salida de npm audit\n', res.stdout, res.stderr);
    process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const failing = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(v.severity)) continue;
    const ex = EXCEPTIONS[name];
    if (ex && today <= ex.until) {
        console.log(`audit-gate: excepcion ${name} (${v.severity}) hasta ${ex.until}: ${ex.reason}`);
        continue;
    }
    failing.push(`${v.severity} ${name}${ex ? ` (excepcion vencida ${ex.until})` : ''}`);
}

if (failing.length) {
    console.error('audit-gate: vulnerabilidades high/critical sin excepcion:\n  ' + failing.join('\n  '));
    process.exit(1);
}
console.log('audit-gate: ok');
