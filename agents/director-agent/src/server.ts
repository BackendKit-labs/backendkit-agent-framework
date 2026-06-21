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
import { verifyToken, isEnterpriseMode } from './auth/jwt.js';
import { requestContext }        from './auth/context.js';
import { ADMIN_PRINCIPAL }       from './auth/types.js';
import { login }                 from './auth/login.js';
import { startWsServer }         from './ws-server.js';
import { writeRegistryFile }     from './registry.js';

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

    const { engine, mcp, policyEngine, auditLogger } = await buildDirectorEngine(config, configDir, onEvent);

    const info = mcp.getServerInfo();
    log(`Agentes conectados: ${info.map(s => `${s.name}(${s.toolCount}t)`).join(', ') || 'ninguno'}`);
    log(`Provider: ${config.director.provider} / ${config.providers[config.director.provider]?.model}`);

    const enforcing      = policyEngine?.isEnforcing() ?? false;
    const enterpriseMode = isEnterpriseMode();
    if (enforcing)       log('RBAC activo — políticas de access_control cargadas');
    if (enterpriseMode)  log('Modo empresa activo — JWT_SECRET configurado');
    if (auditLogger)     log(`Auditoría activa → ${auditLogger.path}`);

    // Publicar registry de tools para auth-service
    writeRegistryFile(mcp).catch(err =>
        log(`⚠ No se pudo escribir el registry: ${(err as Error).message}`),
    );

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
            message:    z.string().describe('Mensaje en lenguaje natural para el Director'),
            user_token: z.string().optional().describe('JWT del usuario autenticado (requerido cuando JWT_SECRET está configurado)'),
        },
        async ({ message, user_token }: { message: string; user_token?: string }) => {
            // ── Capa 1: identidad del usuario ─────────────────────────────────
            let principal = ADMIN_PRINCIPAL;

            if (user_token) {
                try {
                    principal = await verifyToken(user_token);
                } catch (err) {
                    return { content: [{ type: 'text' as const, text: `Error de autenticación: ${(err as Error).message}` }] };
                }
            } else if (enterpriseMode) {
                return { content: [{ type: 'text' as const, text: 'Autenticación requerida: JWT_SECRET está configurado. Incluí user_token en el request.' }] };
            }
            // Si no hay JWT_SECRET → dev/REPL mode, usamos ADMIN_PRINCIPAL sin restricción.

            // ── Run con contexto de Principal ─────────────────────────────────
            outputBuffer = '';
            return requestContext.run({ principal }, async () => {
                try {
                    await engine.run(message);
                    return { content: [{ type: 'text' as const, text: outputBuffer || '(sin respuesta)' }] };
                } catch (err) {
                    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }] };
                }
            });
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

    // @ts-ignore
    mcp_srv.tool(
        'director_login',
        'Autenticar con el Director. Devuelve un JWT (user_token) para usar en director_chat. ' +
        'Requiere que JWT_SECRET esté configurado. Los usuarios se crean desde config-agent (http://localhost:3456/users).',
        {
            username: z.string().describe('Nombre de usuario'),
            password: z.string().describe('Contraseña'),
        },
        async ({ username, password }: { username: string; password: string }) => {
            const result = await login(username, password);
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }] };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        token: result.token,
                        user:  result.user,
                        expires_in: '8h',
                        usage: 'Usá este token en director_chat({ message, user_token: "<token>" })',
                    }),
                }],
            };
        },
    );

    // ── WebSocket front-door ──────────────────────────────────────────────────
    const wsPort = config.director.ws_port;
    startWsServer(wsPort, engine);

    // ── Start stdio transport ─────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await mcp_srv.connect(transport);
    log('MCP stdio listo');
    log('Tools: director_chat, director_clear, director_status, director_login');
}

main().catch(err => {
    process.stderr.write(`[director-agent] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
