# SPEC-0005: agent-subagents y agent-acp

**Fecha:** 2026-10-22
**Estado:** Borrador
**Inspiración:** `subagent/*`, `experimental/agent-team`, `acp`, `subagent-acp` de deepseek-harness (diseño, no código).
**Depende de:** SPEC-0002 (señal de cancelación); la parte *continuable*, el fork y los equipos dependen de SPEC-0004.
**Habilita:** Hermes H2 y H3 (SPEC-0003).

## 1. Problema verificado
Toda delegación actual es interna y de un solo resultado: `ask_agent` → `DelegationBus` → `runAgentInternal`, que arranca un historial nuevo y devuelve texto (`subAgentContextMessages` solo copia mensajes del padre). Agentes remotos o de otros productos solo se alcanzan como *herramientas* (`AgentClient`, MCP). No hay hijos que continúen una conversación, ni `send_message`/`interrupt`/`list`, ni linaje, ni capacidad de hijos vivos, ni integración con Claude Code/Codex, ni protocolo estándar de control de sesión.

## 2. agent-subagents

### 2.1 Contrato
```ts
export interface SubagentProvider {
    readonly name: string;
    readonly capabilities: { continuable: boolean; fork: boolean; structuredOutput: boolean; modelOverride: boolean; interrupt: boolean };
    start(req: SubagentRequest, signal: AbortSignal): Promise<SubagentRun>;   // fulfilled = hay un hijo real
    resume?(childId: string): Promise<SubagentRun>;                           // continuables
}
export interface SubagentRequest {
    task: string; parent: { agentId: string; sessionId: string };
    mode: 'one-shot' | 'continuable'; fork?: boolean;
    agentOptions?: { agentId?: string; model?: string; provider?: string; maxOutputTokens?: number };
    outputSchema?: JSONSchema; depth: number; traceparent?: string;
}
export interface SubagentRun {
    childId: string;
    result(): Promise<{ text: string; structured?: unknown; stop: 'done' | 'aborted' | 'error'; diagnostic?: string }>;
    send?(message: string, opts?: { steer?: boolean }): Promise<'accepted' | 'queued'>;
    interrupt?(): Promise<void>;
}
```
Una opción pedida que el proveedor no soporta **falla al iniciar** con `UNSUPPORTED_OPTION` (no se ignora en silencio).

### 2.2 Servicio y límites
`SubagentService` = registro de proveedores nombrados + límites: `maxDepth` (por defecto 1), `maxActive` de hijos continuables vivos (8; sin cola: `ACTIVATION_LIMIT_REACHED`, porque un padre esperando no debe esperar su propio hueco), un bulkhead para one-shot. Los hijos continuables heredan el pool del padre continuable. Catálogo `list(parentSessionId)` y linaje **sin cargar** a los hijos (lee la proyección de su sesión).

### 2.3 Proveedores
| Proveedor | Modo | Notas |
|---|---|---|
| `in-process` (spawn) | one-shot, continuable* | envuelve `runAgentInternal`; con SPEC-0004 es continuable |
| `in-process-fork` | continuable* | hijo sembrado con el prefijo del log del padre (`session.fork`) |
| `protocol` | one-shot | sobre `AgentClient`; hereda circuit breaker y `traceparent` |
| `mcp` | one-shot | una capacidad MCP como subagente |
| `acp` | one-shot, continuable | proceso hijo que habla ACP (§3) |
| `claude-code` | one-shot | sesión no interactiva de Claude Code por su SDK/CLI, `permissionMode` configurable; credenciales y config nativas |
| `codex` | one-shot | análogo para Codex |
(* requiere SPEC-0004.) Los hijos externos devuelven solo la respuesta final o un diagnóstico seguro; su razonamiento, tráfico de tools y stderr no entran al contexto del padre.

### 2.4 Herramientas del modelo
`subagent` (delegar; `provider`, `task`, `mode`), `send_message`, `interrupt_agent`, `list_agents`. `ask_agent` se mantiene y pasa a ser azúcar sobre el proveedor `in-process`.

### 2.5 Equipos (experimental, requiere SPEC-0004)
Roster durable (líder + compañeros con nombre permanente), buzón de mensajes entre pares (entrega exactamente una vez, cola para los inactivos), tablero de tareas como DAG con `claim/complete/release/reopen` por *compare-and-set*, avisos (no bloqueos) por solapamiento de archivos. Límites configurables: miembros, tareas, mensajes pendientes, tamaño de mensaje.

## 3. agent-acp

### 3.1 Qué es
Implementación del **Agent Client Protocol** (v1, estándar abierto) sobre stdio JSON-RPC. Complementa, no reemplaza: MCP = herramientas; `agent-protocol` = capacidades servicio-a-servicio; ACP = **sesión y control** (prompts en streaming, cancel, resume, configuración).

### 3.2 Servidor (`AcpServer`)
Envuelve cualquier engine del framework: `initialize`, `session/new` (cwd absoluto, servidores MCP), `session/list`, `session/resume`, `session/prompt` (streaming de actualizaciones: texto, tool calls, planes), `session/cancel`, `session/close`, `session/set_config_option` (`model`, `reasoning_effort`). Varias sesiones por conexión, independientes. Las solicitudes de permiso se resuelven con política (`onToolApproval`) o se reenvían al cliente. Stdout solo lleva protocolo. Persistencia de sesiones con SPEC-0004; sin ella, solo sesiones en memoria.
Mapeo de eventos: `token` → `agent_message_chunk`, `tool_call`/`tool_result` → `tool_call`/`tool_call_update`, `thinking` → `agent_thought_chunk`, `done` → `stopReason`, `guardrail`/`system` → texto de aviso.

### 3.3 Cliente (`AcpClient`)
Lanza un agente ACP como proceso hijo y expone `newSession/prompt/cancel`; es la base del proveedor `acp` y del `AcpConnector` de Hermes.

### 3.4 Perfil de lanzamiento
`bk-acp --engine ./engine.js` (o una plantilla `create-bk-agent` con modo de despliegue `acp`) para que cualquier agente creado con el framework sea controlable por editores compatibles con ACP y por Hermes.

## 4. Impacto
Paquetes nuevos `agent-subagents` y `agent-acp`; `agent-core`: el `DelegationBus` pasa a ser el proveedor `in-process` (sin cambio de comportamiento); `agent-protocol`: `traceparent` (SPEC-0003 §4); `create-bk-agent`: modo `acp`. Versiones menores.

## 5. Plan
1. `agent-subagents` núcleo + `in-process` one-shot + `protocol` + `mcp` (equivale a lo actual, con límites y catálogo).
2. `agent-acp` servidor y cliente + proveedor `acp`.
3. Proveedores `claude-code` y `codex`.
4. Con SPEC-0004: continuables, fork, `send_message`/`interrupt`, equipos.

## 6. Pruebas y aceptación
- Contrato de proveedor: batería común ejecutada contra cada implementación (opciones no soportadas fallan; `abort` termina el hijo y no deja procesos).
- Límite de profundidad y de hijos vivos; sin interbloqueos con padres esperando.
- ACP: conformidad con el esquema (`initialize`, ciclo `new → prompt → cancel → close`); un cliente ACP de referencia conversa con un engine nuestro; el servidor no escribe nada en stdout fuera del protocolo; reanudar tras reinicio (con SPEC-0004).
- Claude Code/Codex: prueba en vivo opt-in (requiere sus credenciales), no en CI.
- Aislamiento: un hijo que falla o cuelga no corrompe la sesión del padre.

## 7. Riesgos y preguntas abiertas
- **Seguridad de hijos externos:** ejecutan sin supervisión en el workspace del padre; por defecto `permissionMode` restrictivo y confinamiento por SPEC-0006.
- **Evolución de ACP:** el protocolo es joven; versionar el adaptador y fijar `protocolVersion`.
- **Licencias y binarios** de Claude Code/Codex: los proveedores usan lo que el usuario ya tiene instalado, sin empaquetarlos.
- **Pregunta:** ¿ACP también como transporte de `agent-web` (reemplazo del WebSocket propio)? Propuesta: no ahora; mantener ambos.
