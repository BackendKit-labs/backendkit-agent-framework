#!/usr/bin/env node
/**
 * Test runner for the soporte orchestrator
 *
 * Usage:
 *   node test-flow.mjs atencion-ticket    # standard ticket (triage → L1 → gate → KB)
 *   node test-flow.mjs incidente-critico  # P1 incident (gate → diagnosis → gate → comms → postmortem)
 *   node test-flow.mjs dynamic            # dynamic planning (no flow match)
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
    'atencion-ticket': {
        flow_id: 'atencion-ticket',
        task: 'Atender ticket de soporte: error al exportar reportes en formato Excel',
        payload: {
            ticket_id:   'TKT-2024-1547',
            cliente:     'Acme Corp',
            plan:        'Professional',
            canal:       'Portal de soporte',
            asunto:      'Error al exportar reportes en formato Excel — aparece "Download failed"',
            descripcion: 'Desde ayer a la tarde, cuando intento descargar cualquier reporte en formato Excel (no en CSV), me aparece el mensaje "Download failed" y no se genera ningún archivo. El botón de descarga en PDF sí funciona bien. Lo probé en Chrome y Firefox con el mismo resultado. Necesito los reportes para una reunión de directorio mañana a las 10hs.',
            entorno:     'Chrome 124, Windows 11, cuenta admin. La sesión expira correctamente y puedo hacer todo lo demás en la plataforma sin problemas.',
        },
    },
    'incidente-critico': {
        flow_id: 'incidente-critico',
        task: 'Gestionar incidente crítico: plataforma inaccesible para clientes Enterprise',
        payload: {
            incidente_id:       'INC-2024-003',
            reportado_por:      'Sistema de monitoreo + 3 clientes Enterprise simultáneamente',
            hora_deteccion:     '2024-06-14 09:23 ART',
            descripcion:        'La plataforma devuelve error 503 para todos los usuarios. El health check de la API principal está fallando. Múltiples clientes Enterprise están llamando al número de emergencias.',
            sistemas_afectados: 'API principal (/api/v3/*), Dashboard web, Mobile app. La base de datos parece responder (status page de RDS en verde).',
            clientes_impactados: 'Estimado 100% de usuarios activos en este momento (~340 sesiones activas según los últimos logs disponibles)',
            sintomas:           'HTTP 503 en todas las rutas de la API. Los worker processes de Node.js no están respondiendo. Los logs muestran "FATAL: Cannot allocate memory" repetidamente desde las 09:18.',
            logs:               'FATAL: Cannot allocate memory in static TLS block\nnode: Cannot allocate memory\nAborted (core dumped)\nRestarting worker... (intent 47 en los últimos 5 minutos)',
            cambios_recientes:  'Deploy de v3.4.1 a las 08:45 (35 minutos antes del incidente). El deploy incluyó actualización de una dependencia de procesamiento de imágenes.',
        },
    },
    'dynamic': {
        flow_id: undefined,
        task: process.env.TASK ?? 'Analizar los tickets de la última semana e identificar los 3 problemas más frecuentes que deberían documentarse como artículos de KB',
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
    const flowKey = process.argv[2] ?? 'atencion-ticket';
    const flowDef = FLOWS[flowKey];
    if (!flowDef) {
        console.error(`Unknown flow: ${flowKey}\nOptions: ${Object.keys(FLOWS).join(', ')}`);
        process.exit(1);
    }
    if (!fs.existsSync(SERVER_PATH)) {
        console.error(`Server not found:\n  ${SERVER_PATH}\nRun: npm install`);
        process.exit(1);
    }

    console.log(`\nStarting orchestrator (soporte)...`);
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
