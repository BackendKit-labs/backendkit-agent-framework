#!/usr/bin/env node
/**
 * Test runner for the ventas orchestrator
 *
 * Usage:
 *   node test-flow.mjs calificacion-lead    # lead qualification flow
 *   node test-flow.mjs propuesta-comercial  # commercial proposal flow (2 gates)
 *   node test-flow.mjs dynamic              # dynamic planning (no flow match)
 */

import { spawn }          from 'node:child_process';
import { createInterface } from 'node:readline';
import * as path          from 'node:path';
import * as fs            from 'node:fs';
import * as url           from 'node:url';

const __dirname   = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, 'orchestrator.yaml');
const SERVER_PATH = path.resolve(
    __dirname,
    'node_modules/@backendkit-labs/orchestrator-agent/dist/server.js',
);

// ── Sample payloads ───────────────────────────────────────────────────────────

const FLOWS = {
    'calificacion-lead': {
        flow_id: 'calificacion-lead',
        task: 'Calificar nuevo lead: Acme Corp',
        payload: {
            empresa:     'Acme Corp',
            contacto:    'Jane Smith',
            cargo:       'CTO',
            email:       'jane@acme.com',
            descripcion: 'Empresa fintech de 80 personas, necesitan modernizar su stack de pagos. Mencionaron presupuesto de $80k-120k para el año.',
        },
    },
    'propuesta-comercial': {
        flow_id: 'propuesta-comercial',
        task: 'Elaborar propuesta comercial para Acme Corp',
        payload: {
            empresa:      'Acme Corp',
            contacto:     'Jane Smith',
            cargo:        'CTO',
            servicio:     'Modernización de plataforma de pagos (backend Node.js + migración a cloud)',
            necesidad:    'Reemplazar sistema legacy de pagos con alta deuda técnica que falla 2-3 veces por mes',
            presupuesto:  '$80.000 - $120.000 USD',
            timeline:     '6 meses, con primera fase funcional en 3 meses',
            contexto:     'Lead calificado HOT, CTO es el decisor, board aprobó presupuesto Q1. Evalúan también a un competidor.',
        },
    },
    'dynamic': {
        flow_id: undefined,
        task: process.env.TASK ?? 'Preparar análisis de oportunidades de upsell para los clientes actuales que llevan más de 6 meses con soporte mensual',
        payload: {},
    },
};

// ── MCP Client (stdio) ────────────────────────────────────────────────────────

class McpClient {
    constructor(serverPath) {
        this._nextId  = 1;
        this._pending = new Map();

        const env    = { ...process.env };
        const dotenv = path.join(__dirname, '.env');
        if (fs.existsSync(dotenv)) {
            for (const line of fs.readFileSync(dotenv, 'utf-8').split('\n')) {
                const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
                if (m && m[2] && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
            }
        }

        this._proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'], env });

        const rl = createInterface({ input: this._proc.stdout });
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
                    else resolve(msg.result);
                }
            } catch {}
        });

        this._proc.on('error', (err) => console.error('[MCP] error:', err.message));
    }

    _send(msg) { this._proc.stdin.write(JSON.stringify(msg) + '\n'); }

    async initialize() {
        const id = this._nextId++;
        const p  = new Promise((res, rej) => this._pending.set(id, { resolve: res, reject: rej }));
        this._send({ jsonrpc: '2.0', id, method: 'initialize', params: {
            protocolVersion: '2024-11-05', capabilities: {},
            clientInfo: { name: 'test-flow', version: '0.1.0' },
        }});
        await p;
        this._send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    }

    async callTool(name, args) {
        const id = this._nextId++;
        const p  = new Promise((res, rej) => {
            this._pending.set(id, { resolve: res, reject: rej });
            setTimeout(() => {
                if (this._pending.has(id)) { this._pending.delete(id); rej(new Error(`Timeout: ${name}`)); }
            }, 120_000);
        });
        this._send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
        return p;
    }

    close() { this._proc.stdin.end(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const extractText = (r) => r?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? String(r);
const sleep       = (ms) => new Promise(r => setTimeout(r, ms));

function printSection(title, text) {
    const line = '─'.repeat(60);
    console.log(`\n${line}\n  ${title}\n${line}`);
    console.log(text);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const flowKey = process.argv[2] ?? 'calificacion-lead';
    const flowDef = FLOWS[flowKey];
    if (!flowDef) {
        console.error(`Unknown flow: ${flowKey}\nOptions: ${Object.keys(FLOWS).join(', ')}`);
        process.exit(1);
    }
    if (!fs.existsSync(SERVER_PATH)) {
        console.error(`Server not found:\n  ${SERVER_PATH}\nRun: npm install`);
        process.exit(1);
    }

    console.log(`\nStarting orchestrator (ventas)...`);
    console.log(`  Flow:   ${flowKey}`);

    const client = new McpClient(SERVER_PATH);
    try {
        await client.initialize();
        console.log('  MCP: connected ✓\n');

        const runArgs = { config_path: CONFIG_PATH, task: flowDef.task };
        if (flowDef.flow_id) runArgs.flow_id = flowDef.flow_id;
        if (Object.keys(flowDef.payload).length > 0) runArgs.payload = flowDef.payload;

        const startText = extractText(await client.callTool('orchestrator_run', runArgs));
        printSection('RUN STARTED', startText);

        const runIdMatch = startText.match(/runId:\s*`?([a-z0-9-]+)`?/i);
        if (!runIdMatch) { console.error('\n[ERROR] Could not extract runId.'); process.exit(1); }
        const runId = runIdMatch[1];

        let attempts = 0, lastStatus = '';
        console.log(`\nPolling (runId: ${runId})...\n`);

        while (attempts < 80) {
            await sleep(5000);
            attempts++;

            const statusText = extractText(await client.callTool('orchestrator_status', {
                config_path: CONFIG_PATH, run_id: runId,
            }));
            const status = statusText.match(/status:\s*\*\*([^*]+)\*\*/)?.[1]
                        ?? statusText.match(/^status:\s*(\S+)/m)?.[1]
                        ?? 'unknown';

            if (status !== lastStatus) {
                process.stdout.write(`  [${new Date().toLocaleTimeString()}] status: ${status}\n`);
                lastStatus = status;
            }

            if (status === 'complete') { printSection('RESULT', statusText); break; }
            if (status === 'failed')   { printSection('ERROR', statusText); break; }

            if (status === 'waiting_gate') {
                printSection('GATE — APPROVAL REQUIRED', statusText);
                console.log('\nAuto-approving...\n');
                await sleep(2000);
                const approveText = extractText(await client.callTool('orchestrator_approve', {
                    config_path: CONFIG_PATH, run_id: runId,
                    approved: true, notes: 'Auto-approved by test-flow.mjs',
                }));
                printSection('GATE APPROVED', approveText);
                lastStatus = '';
            }
        }

        if (attempts >= 80) console.log('\n[TIMEOUT] Check orchestrator_status manually.');
    } finally {
        client.close();
    }
}

main().catch(err => { console.error('\n[FATAL]', err.message); process.exit(1); });
