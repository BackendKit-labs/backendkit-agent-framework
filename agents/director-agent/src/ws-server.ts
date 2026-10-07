/**
 * WebSocket front-door del Director Agent (:ws_port, default 3500).
 *
 * Protocolo (cliente → servidor):
 *   { type: "login", email, password }      → autenticar con credenciales (abac-service)
 *   { type: "auth",  token }                → autenticar con JWT existente
 *   { type: "chat",  message }              → enviar mensaje al Director
 *                                              ("/pulse on|off|status" se maneja acá,
 *                                              sin pasar por el LLM — modo proactivo)
 *   { type: "clear" }                       → limpiar historial de la sesión
 *
 * Protocolo (servidor → cliente):
 *   { type: "ready",      auth_required }   → connection establecida
 *   { type: "auth_ok",    token, user }     → login exitoso
 *   { type: "auth_error", error }           → login fallido
 *   { type: "token",      content }         → streaming de respuesta
 *   { type: "done" }                        → respuesta completa
 *   { type: "error",      message }         → error en el procesamiento
 *   { type: "notification", message }       → aviso proactivo (ej: un run del coder
 *                                              terminó) — no es respuesta a un mensaje
 *                                              del usuario, puede llegar en cualquier momento
 */

import { createServer }  from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname }  from 'node:path';
import { fileURLToPath }  from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { login }              from './auth/login.js';
import { verifyToken, isEnterpriseMode } from './auth/jwt.js';
import { requestContext }     from './auth/context.js';
import { ADMIN_PRINCIPAL }    from './auth/types.js';
import type { Principal }     from './auth/types.js';
import type { SessionEngineManager } from './engine.js';

const UI_DIST = join(fileURLToPath(import.meta.url), '..', '..', 'ui', 'dist');

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.woff2': 'font/woff2',
};

async function serveStatic(pathname: string, res: import('node:http').ServerResponse): Promise<boolean> {
    try {
        let filePath = join(UI_DIST, pathname === '/' ? 'index.html' : pathname);
        try { await stat(filePath); } catch { filePath = join(UI_DIST, 'index.html'); }
        const data = await readFile(filePath);
        const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
        return true;
    } catch {
        return false;
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingMsg {
    type:      'login' | 'auth' | 'chat' | 'clear';
    email?:    string;
    username?: string; // legacy alias — acepta ambos
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

function handleConnection(
    ws:                WebSocket,
    manager:           SessionEngineManager,
    connectionsByUser: Map<string, Set<WebSocket>>,
): void {
    let principal: Principal | null = null;
    let registeredKey: string | null = null;

    const enterpriseMode = isEnterpriseMode();
    send(ws, { type: 'ready', auth_required: enterpriseMode });

    // Registra esta conexión para el principal activo, así el RunWatcher puede
    // empujarle una notificación aunque no haya un mensaje de chat en curso.
    // Idempotente — se llama en cada mensaje una vez autenticado.
    const registerConnection = (p: Principal, manager: SessionEngineManager) => {
        // Reactiva/refresca la suscripción de pulso en cada mensaje autenticado:
        // es la única vía por la que una suscripción persistida vuelve a correr
        // tras un reinicio (nunca se rehidrata un Principal de disco), y de paso
        // renueva el TTL — "actividad reciente" mantiene el pulso vivo.
        manager.pulse.reactivate(p);

        const key = p.id || 'anon';
        if (registeredKey === key) return;
        registeredKey = key;
        let set = connectionsByUser.get(key);
        if (!set) { set = new Set(); connectionsByUser.set(key, set); }
        set.add(ws);
    };

    ws.on('close', () => {
        if (registeredKey) connectionsByUser.get(registeredKey)?.delete(ws);
    });

    ws.on('message', async (raw) => {
        let msg: IncomingMsg;
        try { msg = JSON.parse(raw.toString()) as IncomingMsg; }
        catch { send(ws, { type: 'error', message: 'Mensaje JSON inválido' }); return; }

        // ── Autenticación ──────────────────────────────────────────────────────

        if (msg.type === 'login') {
            const emailOrUser = msg.email ?? msg.username;
            if (!emailOrUser || !msg.password) {
                send(ws, { type: 'auth_error', error: 'email y password requeridos' });
                return;
            }
            const result = await login(emailOrUser, msg.password);
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
            send(ws, { type: 'error', message: 'No autenticado. Enviá { type: "login", email, password } primero.' });
            return;
        }
        registerConnection(activePrincipal, manager);

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

            // Comando de modo proactivo — se resuelve acá, sin gastar un turno LLM.
            const pulseCmd = /^\/(?:pulse|proactivo)\s+(on|off|status)\s*$/i.exec(msg.message.trim());
            if (pulseCmd) {
                const action = pulseCmd[1]!.toLowerCase();
                const reply  = action === 'on'  ? manager.pulse.subscribe(activePrincipal)
                             : action === 'off' ? manager.pulse.unsubscribe(activePrincipal.id)
                             :                    manager.pulse.statusFor(activePrincipal.id);
                send(ws, { type: 'token', content: reply });
                send(ws, { type: 'done' });
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
    const http = createServer(async (req, res) => {
        const pathname = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;
        const served = await serveStatic(pathname, res);
        if (!served) {
            res.writeHead(404); res.end('Not found');
        }
    });

    const wss = new WebSocketServer({ server: http });

    // Por-principal, no por-conexión: un usuario con varias pestañas recibe la
    // notificación en todas. El RunWatcher (uno por engine de sesión) empuja acá
    // cuando un run de orchestrator_run/orchestrator_sdd sale de "running".
    const connectionsByUser = new Map<string, Set<WebSocket>>();
    const pushToUser = (principalId: string, message: string) => {
        for (const conn of connectionsByUser.get(principalId) ?? []) {
            send(conn, { type: 'notification', message });
        }
    };
    manager.runWatcher.setNotifier(pushToUser);
    manager.pulse.setNotifier(pushToUser);

    // El pulso corre como el usuario — en dev (sin ABAC_PUBLIC_KEY) "el usuario"
    // es siempre ADMIN_PRINCIPAL, así que ahí exige el opt-in explícito allow_dev.
    if (manager.pulse.isEnabled) {
        if (isEnterpriseMode() || manager.pulse.allowsDev) {
            manager.pulse.start();
        } else {
            process.stderr.write(
                '[pulse] proactive.enabled=true pero el director corre en modo dev (sin ABAC_PUBLIC_KEY) ' +
                'y allow_dev es false — el pulso queda apagado. Seteá proactive.allow_dev: true para probarlo en dev.\n',
            );
        }
    }

    wss.on('connection', (ws) => handleConnection(ws, manager, connectionsByUser));

    http.listen(port, () => {
        process.stderr.write(`[director-agent] WebSocket listo en ws://localhost:${port}\n`);
    });
}
