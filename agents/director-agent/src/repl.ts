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

import 'dotenv/config';
import * as readline from 'node:readline';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { loadConfig } from './config.js';
import { buildDirectorEngine, resolveConfigPath } from './engine.js';

// ── REPL commands ─────────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
    '/help':   'Mostrar comandos disponibles',
    '/agents': 'Ver agentes MCP conectados y sus tools',
    '/clear':  'Limpiar historial de conversación',
    '/status': 'Estado del director (modelo, provider, conexiones)',
    '/quit':   'Salir',
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

    printBanner(config.director.name, runtime.provider, runtime.model, serverInfo, totalTools);

    // ── readline REPL ─────────────────────────────────────────────────────────
    const rl = readline.createInterface({
        input:    process.stdin,
        output:   process.stdout,
        terminal: true,
    });

    const prompt = () => {
        rl.question('\n  [◆ Director] > ', async (input) => {
            const line = input.trim();
            if (!line) { prompt(); return; }

            // ── Built-in commands ─────────────────────────────────────────────
            if (line === '/quit' || line === '/exit') {
                console.log('\n  Hasta luego.\n');
                await mcp.disconnect();
                rl.close();
                return;
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
                await engine.run(line);
            } catch (err) {
                console.error(`\n  ✗ Error: ${(err as Error).message}`);
            }
            console.log('');
            prompt();
        });
    };

    prompt();
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
): void {
    const agentList = servers.length > 0
        ? servers.map(s => `${s.name} (${s.toolCount}t)`).join(' · ')
        : 'ninguno conectado';
    console.error('');
    console.error('  ╔═══════════════════════════════════════════╗');
    console.error(`  ║  ${name.padEnd(41)}║`);
    console.error('  ║  BackendKit Platform — Director           ║');
    console.error('  ╚═══════════════════════════════════════════╝');
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
