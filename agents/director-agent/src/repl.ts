#!/usr/bin/env node
/**
 * Director Agent — interactive REPL
 *
 * Lanzalo directamente:
 *   node dist/repl.js
 *   node dist/repl.js /path/to/director.yaml
 *
 * Env vars:
 *   DEEPSEEK_API_KEY   (o la que configure tu provider en director.yaml)
 *   DIRECTOR_CONFIG    ruta al director.yaml (alternativa al argumento)
 */

// Carga .env desde cwd O desde el directorio raíz del paquete (2 niveles arriba del .js)
// — igual que server.ts, para que funcione sin importar desde qué directorio se corra.
import * as fsSync   from 'node:fs';
import * as pathSync from 'node:path';
import { fileURLToPath } from 'node:url';
(function loadDotEnv() {
    const pkgRoot    = pathSync.resolve(fileURLToPath(import.meta.url), '..', '..');
    const candidates = [pathSync.join(process.cwd(), '.env'), pathSync.join(pkgRoot, '.env')];
    for (const f of candidates) {
        if (!fsSync.existsSync(f)) continue;
        for (const line of fsSync.readFileSync(f, 'utf-8').split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
        break;
    }
})();

import * as readline from 'node:readline';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { loadConfig } from './config.js';
import { buildDirectorEngine, resolveConfigPath } from './engine.js';
import { login }            from './auth/login.js';
import { isEnterpriseMode } from './auth/jwt.js';
import { requestContext }   from './auth/context.js';
import { ADMIN_PRINCIPAL }  from './auth/types.js';
import type { Principal }   from './auth/types.js';

// ── REPL commands ─────────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
    '/help':    'Mostrar comandos disponibles',
    '/whoami':  'Ver usuario y rol de la sesión actual',
    '/agents':  'Ver agentes MCP conectados y sus tools',
    '/clear':   'Limpiar historial de conversación',
    '/status':  'Estado del director (modelo, provider, conexiones)',
    '/logout':  'Cerrar sesión y volver al login',
    '/quit':    'Salir',
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const configPath = resolveConfigPath(process.argv[2]);

    let config;
    let configDir: string;
    try {
        const loaded = loadConfig(configPath);
        config    = loaded.config;
        configDir = loaded.configDir;
    } catch (err) {
        console.error(`\n  ✗ ${(err as Error).message}\n`);
        process.exit(1);
    }

    console.error('');
    console.error('  Conectando agentes MCP...');

    let runtime;
    try {
        runtime = await buildDirectorEngine(config, configDir, handleEvent);
    } catch (err) {
        console.error(`\n  ✗ Error iniciando director: ${(err as Error).message}\n`);
        process.exit(1);
    }

    const { engine, mcp } = runtime;
    const serverInfo = mcp.getServerInfo();
    const totalTools = mcp.getTools().length;

    // ── Login (si JWT_SECRET está seteado) ───────────────────────────────────
    const rl = readline.createInterface({
        input:    process.stdin,
        output:   process.stdout,
        terminal: true,
    });

    let principal: Principal = ADMIN_PRINCIPAL;

    if (isEnterpriseMode()) {
        principal = await replLogin(rl);
    }

    printBanner(config.director.name, runtime.provider, runtime.model, serverInfo, totalTools, principal);

    // ── readline REPL ─────────────────────────────────────────────────────────
    const promptStr = () => {
        const who = principal.id === 'system'
            ? '◆ Director'
            : `◆ ${principal.id} (${principal.role})`;
        return `\n  [${who}] > `;
    };

    const prompt = () => {
        rl.question(promptStr(), async (input) => {
            const line = input.trim();
            if (!line) { prompt(); return; }

            // ── Built-in commands ─────────────────────────────────────────────
            if (line === '/quit' || line === '/exit') {
                console.log('\n  Hasta luego.\n');
                await mcp.disconnect();
                rl.close();
                return;
            }
            if (line === '/whoami') {
                console.log(`\n  Usuario: ${principal.id}`);
                console.log(`  Rol:     ${principal.role}`);
                if (principal.department) console.log(`  Depto:   ${principal.department}`);
                console.log(`  Modo:    ${isEnterpriseMode() ? 'empresa (JWT activo)' : 'dev (sin JWT_SECRET)'}`);
                console.log('');
                prompt(); return;
            }
            if (line === '/logout') {
                if (!isEnterpriseMode()) {
                    console.log('\n  Modo dev — no hay sesión activa que cerrar.\n');
                    prompt(); return;
                }
                engine.clearHistory();
                console.log('\n  Sesión cerrada. Iniciá sesión de nuevo.\n');
                principal = await replLogin(rl);
                printBanner(config.director.name, runtime.provider, runtime.model,
                    mcp.getServerInfo(), mcp.getTools().length, principal);
                prompt(); return;
            }
            if (line === '/help') {
                console.log('\n  Comandos:');
                for (const [cmd, desc] of Object.entries(COMMANDS)) {
                    console.log(`    ${cmd.padEnd(12)} ${desc}`);
                }
                console.log('');
                prompt(); return;
            }
            if (line === '/clear') {
                engine.clearHistory();
                console.log('\n  Historial limpiado.\n');
                prompt(); return;
            }
            if (line === '/status') {
                console.log(`\n  Provider: ${runtime.provider}  Modelo: ${runtime.model}`);
                const info = mcp.getServerInfo();
                if (info.length === 0) {
                    console.log('  Agentes: ninguno conectado');
                } else {
                    for (const s of info) {
                        console.log(`  ✓ ${s.name} (${s.toolCount} tools via ${s.transportUsed})`);
                    }
                }
                console.log('');
                prompt(); return;
            }
            if (line === '/agents') {
                const info = mcp.getServerInfo();
                if (info.length === 0) {
                    console.log('\n  Ningún agente conectado.\n');
                    prompt(); return;
                }
                for (const s of info) {
                    const tools = mcp.getServerTools(s.name).map(t => {
                        const parts = t.name.split('__');
                        return parts[parts.length - 1] ?? t.name;
                    });
                    console.log(`\n  [${s.name}] — ${s.toolCount} tools (${s.transportUsed})`);
                    console.log(`    ${tools.join(', ')}`);
                }
                console.log('');
                prompt(); return;
            }
            if (line.startsWith('/')) {
                console.log('  Comando desconocido. Escribí /help.\n');
                prompt(); return;
            }

            // ── Run director ──────────────────────────────────────────────────
            console.log('');
            try {
                await requestContext.run({ principal }, () => engine.run(line));
            } catch (err) {
                console.error(`\n  ✗ Error: ${(err as Error).message}`);
            }
            console.log('');
            prompt();
        });
    };

    prompt();
}

// ── Login helper ──────────────────────────────────────────────────────────────

async function replLogin(rl: readline.Interface): Promise<Principal> {
    console.error('');
    console.error('  ┌─────────────────────────────────────────────┐');
    console.error('  │  Director Agent — Inicio de sesión          │');
    console.error('  └─────────────────────────────────────────────┘');

    const ask = (q: string): Promise<string> =>
        new Promise(resolve => rl.question(q, resolve));

    const askHidden = (q: string): Promise<string> => {
        return new Promise(resolve => {
            process.stdout.write(q);
            // Ocultar input en la terminal
            process.stdin.setRawMode?.(true);
            let pwd = '';
            const handler = (buf: Buffer) => {
                const ch = buf.toString('utf8');
                if (ch === '\r' || ch === '\n') {
                    process.stdin.setRawMode?.(false);
                    process.stdin.removeListener('data', handler);
                    process.stdout.write('\n');
                    resolve(pwd);
                } else if (ch === '') { // Ctrl+C
                    process.exit(0);
                } else if (ch === '' || ch === '\b') { // backspace
                    if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b'); }
                } else {
                    pwd += ch;
                    process.stdout.write('•');
                }
            };
            process.stdin.on('data', handler);
        });
    };

    while (true) {
        const username = (await ask('  Usuario: ')).trim();
        const password = await askHidden('  Contraseña: ');

        const result = await login(username, password);
        if (result.ok) {
            console.error(`\n  ✅ Sesión iniciada como ${result.user.id} (${result.user.role})\n`);
            return result.user;
        }
        console.error(`\n  ✗ ${result.error}. Intentá de nuevo.\n`);
    }
}

// ── Event handler (streaming to terminal) ─────────────────────────────────────

function handleEvent(evt: AgentEvent): void {
    switch (evt.type) {
        case 'token':
            process.stdout.write(evt.content);
            break;
        case 'tool_call': {
            const parts   = evt.name.split('__');
            const toolName = parts[parts.length - 1] ?? evt.name;
            const server   = parts[1]?.replace(/_/g, '-') ?? '';
            const preview  = evt.args_preview ? ` ${evt.args_preview.slice(0, 80)}` : '';
            console.log(`\n  ⟶ [${server}] ${toolName}${preview}`);
            break;
        }
        case 'tool_result': {
            const preview = (evt.preview ?? '').slice(0, 120).replace(/\n/g, ' ');
            console.log(`  ${evt.success ? '✓' : '✗'} ${preview}`);
            break;
        }
        case 'block_start':
            break;
        case 'block_end':
            break;
    }
}

// ── Banner ────────────────────────────────────────────────────────────────────

function printBanner(
    name:       string,
    provider:   string,
    model:      string,
    servers:    Array<{ name: string; toolCount: number }>,
    totalTools: number,
    principal:  Principal,
): void {
    const agentList = servers.length > 0
        ? servers.map(s => `${s.name} (${s.toolCount}t)`).join(' · ')
        : 'ninguno conectado';
    const userLine = principal.id === 'system'
        ? 'modo dev (admin implícito)'
        : `${principal.id}  ·  rol: ${principal.role}${principal.department ? `  ·  ${principal.department}` : ''}`;
    console.error('');
    console.error('  ╔═══════════════════════════════════════════╗');
    console.error(`  ║  ${name.padEnd(41)}║`);
    console.error('  ║  BackendKit Platform — Director           ║');
    console.error('  ╚═══════════════════════════════════════════╝');
    console.error(`  Usuario:  ${userLine}`);
    console.error(`  Modelo:   ${provider} / ${model}`);
    console.error(`  Agentes:  ${agentList}`);
    console.error(`  Tools:    ${totalTools} disponibles`);
    console.error('');
    console.error('  Hablame en lenguaje natural. /help para comandos.');
    console.error('');
}

main().catch(err => {
    console.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
});
