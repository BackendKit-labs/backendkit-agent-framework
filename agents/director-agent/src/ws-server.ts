/**
 * WebSocket front-door del Director Agent (:ws_port, default 3500).
 *
 * Protocolo (cliente → servidor):
 *   { type: "login", username, password }   → autenticar con credenciales
 *   { type: "auth",  token }                → autenticar con JWT existente
 *   { type: "chat",  message }              → enviar mensaje al Director
 *   { type: "clear" }                       → limpiar historial de la sesión
 *
 * Protocolo (servidor → cliente):
 *   { type: "ready",      auth_required }   → connection establecida
 *   { type: "auth_ok",    token, user }     → login exitoso
 *   { type: "auth_error", error }           → login fallido
 *   { type: "token",      content }         → streaming de respuesta
 *   { type: "done" }                        → respuesta completa
 *   { type: "error",      message }         → error en el procesamiento
 */

import { createServer }  from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { login }              from './auth/login.js';
import { verifyToken, isEnterpriseMode } from './auth/jwt.js';
import { requestContext }     from './auth/context.js';
import { ADMIN_PRINCIPAL }    from './auth/types.js';
import type { Principal }     from './auth/types.js';
import type { SessionEngineManager } from './engine.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingMsg {
    type:      'login' | 'auth' | 'chat' | 'clear';
    username?: string;
    password?: string;
    token?:    string;
    message?:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

// ── Session handler ───────────────────────────────────────────────────────────
//
// Cada usuario tiene su propio engine (historial/memoria aislados) vía el
// manager. El engine serializa sus propios run() internamente, así que no hace
// falta un mutex global — usuarios distintos corren en paralelo.

function handleConnection(ws: WebSocket, manager: SessionEngineManager): void {
    let principal: Principal | null = null;

    const enterpriseMode = isEnterpriseMode();
    send(ws, { type: 'ready', auth_required: enterpriseMode });

    ws.on('message', async (raw) => {
        let msg: IncomingMsg;
        try { msg = JSON.parse(raw.toString()) as IncomingMsg; }
        catch { send(ws, { type: 'error', message: 'Mensaje JSON inválido' }); return; }

        // ── Autenticación ──────────────────────────────────────────────────────

        if (msg.type === 'login') {
            if (!msg.username || !msg.password) {
                send(ws, { type: 'auth_error', error: 'username y password requeridos' });
                return;
            }
            const result = await login(msg.username, msg.password);
            if (result.ok) {
                principal = result.user;
                send(ws, { type: 'auth_ok', token: result.token, user: result.user });
            } else {
                send(ws, { type: 'auth_error', error: result.error });
            }
            return;
        }

        if (msg.type === 'auth') {
            if (!msg.token) { send(ws, { type: 'auth_error', error: 'token requerido' }); return; }
            try {
                principal = await verifyToken(msg.token);
                send(ws, { type: 'auth_ok', token: msg.token, user: principal });
            } catch (err) {
                send(ws, { type: 'auth_error', error: (err as Error).message });
            }
            return;
        }

        // ── Verificar identidad antes de chatear ───────────────────────────────

        const activePrincipal = principal ?? (enterpriseMode ? null : ADMIN_PRINCIPAL);
        if (!activePrincipal) {
            send(ws, { type: 'error', message: 'No autenticado. Enviá { type: "login", username, password } primero.' });
            return;
        }

        // ── Clear ──────────────────────────────────────────────────────────────

        if (msg.type === 'clear') {
            manager.clearHistory(activePrincipal);
            send(ws, { type: 'done' });
            return;
        }

        // ── Chat ───────────────────────────────────────────────────────────────

        if (msg.type === 'chat') {
            if (!msg.message?.trim()) {
                send(ws, { type: 'error', message: 'message no puede estar vacío' });
                return;
            }

            const engine = manager.get(activePrincipal);
            try {
                await requestContext.run(
                    {
                        principal: activePrincipal,
                        onEvent: (evt: AgentEvent) => {
                            if (evt.type === 'token') {
                                send(ws, { type: 'token', content: evt.content });
                            } else if (evt.type === 'done') {
                                send(ws, { type: 'done' });
                            } else if (evt.type === 'error') {
                                send(ws, { type: 'error', message: evt.message });
                            } else if (evt.type === 'tool_call') {
                                const parts = evt.name.split('__');
                                send(ws, { type: 'tool_call', name: parts[parts.length - 1] ?? evt.name, server: parts[1] ?? '', preview: evt.args_preview });
                            } else if (evt.type === 'tool_result') {
                                const parts = evt.name.split('__');
                                send(ws, { type: 'tool_result', name: parts[parts.length - 1] ?? evt.name, success: evt.success, preview: evt.preview });
                            }
                        },
                    },
                    () => engine.run(msg.message!),
                );
            } catch (err) {
                send(ws, { type: 'error', message: (err as Error).message });
                send(ws, { type: 'done' });
            }
        }
    });

    ws.on('error', (err) => {
        process.stderr.write(`[ws-server] socket error: ${err.message}\n`);
    });
}

// ── Server factory ────────────────────────────────────────────────────────────

export function startWsServer(port: number, manager: SessionEngineManager): void {
    const http = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            service: 'director-agent-ws',
            auth_required: isEnterpriseMode(),
        }));
    });

    const wss = new WebSocketServer({ server: http });

    wss.on('connection', (ws) => handleConnection(ws, manager));

    http.listen(port, () => {
        process.stderr.write(`[director-agent] WebSocket listo en ws://localhost:${port}\n`);
    });
}
