#!/usr/bin/env node
/**
 * Director Agent — MCP server (stdio) + WebSocket server (:ws_port)
 *
 * MCP stdio: Claude Desktop / Claude Code lo consumen como MCP server.
 * WebSocket:  front-door de chat para UIs (agent-web-ui, director-desktop).
 *
 * Env vars:
 *   DEEPSEEK_API_KEY   (o la que configure tu provider)
 *   DIRECTOR_CONFIG    ruta al director.yaml
 */

import 'dotenv/config';
import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                    from 'zod';
import type { AgentEvent }      from '@backendkit-labs/agent-core';
import { loadConfig }           from './config.js';
import { buildDirectorEngine, resolveConfigPath } from './engine.js';

const log = (msg: string) => process.stderr.write(`[director-agent] ${msg}\n`);

async function main(): Promise<void> {
    const configPath = resolveConfigPath(process.argv[2]);

    const { config, configDir } = loadConfig(configPath);

    log('Iniciando director...');

    // Collect output from engine runs (streaming buffered per run)
    let outputBuffer = '';
    const onEvent = (evt: AgentEvent) => {
        if (evt.type === 'token') outputBuffer += evt.content;
    };

    const { engine, mcp } = await buildDirectorEngine(config, configDir, onEvent);

    const info = mcp.getServerInfo();
    log(`Agentes conectados: ${info.map(s => `${s.name}(${s.toolCount}t)`).join(', ') || 'ninguno'}`);
    log(`Provider: ${config.director.provider} / ${config.providers[config.director.provider]?.model}`);

    // ── MCP tools ─────────────────────────────────────────────────────────────

    const mcp_srv = new McpServer({
        name:    '@backendkit-labs/director-agent',
        version: '0.1.0',
    });

    // @ts-ignore
    mcp_srv.tool(
        'director_chat',
        'Enviá un mensaje al Director en lenguaje natural. Entiende intención, busca contexto, y delega al agente correcto (conocimiento, planificación, ops, código). Devuelve la respuesta completa.',
        {
            message: z.string().describe('Mensaje en lenguaje natural para el Director'),
        },
        async ({ message }: { message: string }) => {
            outputBuffer = '';
            try {
                await engine.run(message);
                return { content: [{ type: 'text' as const, text: outputBuffer || '(sin respuesta)' }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }] };
            }
        },
    );

    // @ts-ignore
    mcp_srv.tool(
        'director_clear',
        'Limpia el historial de conversación del Director. Útil para empezar una tarea nueva sin contexto previo.',
        {},
        async () => {
            engine.clearHistory();
            return { content: [{ type: 'text' as const, text: 'Historial limpiado.' }] };
        },
    );

    // @ts-ignore
    mcp_srv.tool(
        'director_status',
        'Estado del Director: modelo, provider, agentes conectados y tools disponibles.',
        {},
        async () => {
            const servers = mcp.getServerInfo();
            const lines = [
                `Director: ${config.director.name}`,
                `Provider: ${config.director.provider} / ${config.providers[config.director.provider]?.model}`,
                `Agentes conectados: ${servers.length}`,
                ...servers.map(s => `  ${s.name} — ${s.toolCount} tools (${s.transportUsed})`),
                `Tools totales: ${mcp.getTools().length}`,
            ];
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        },
    );

    // ── Start stdio transport ─────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await mcp_srv.connect(transport);
    log('MCP stdio listo');
    log('Tools: director_chat, director_clear, director_status');
}

main().catch(err => {
    process.stderr.write(`[director-agent] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
