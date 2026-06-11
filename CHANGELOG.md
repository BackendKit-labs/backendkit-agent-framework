# Changelog

## v0.22.0 (2026-06-10)

### `@backendkit-labs/agent-web` 0.1.0 — nuevo paquete

Capa HTTP/WebSocket que envuelve `AgentEngine` y lo expone al browser.

#### `WebSocketTransport`

Implementa la interfaz `Transport` de `agent-core` sobre un WebSocket de `@fastify/websocket`. Traduce `AgentEvent` a frames JSON. Maneja reconexiones y cierre limpio.

```typescript
// El engine recibe un WebSocketTransport en lugar de CallbackTransport
const transport = new WebSocketTransport(socket);
const engine = new AgentEngine({ transport, ... });
```

#### `SessionManager`

Gestiona N sesiones concurrentes. Una `AgentEngine` instance por sesión. Sweep automático de sesiones idle (default: 30 min). Límite configurable de sesiones simultáneas (default: 100).

#### `AgentServer`

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({
    port: 3000,
    engineFactory: (sessionId, transport) => new AgentEngine({ transport, ... }),
    auth: async (req, reply) => { /* JWT / API key / OIDC — hook pluggable */ },
    cors: '*',
    maxSessions: 100,
    maxIdleMs: 30 * 60 * 1000,
});

await server.start();
```

**Rutas:**

| Ruta | Descripción |
|---|---|
| `WS /chat` | Conectar sesión. Enviar `{ type: 'input', content }` / `{ type: 'abort' }` |
| `GET /health` | Estado del servidor y número de sesiones activas |
| `GET /sessions` | Lista de sesiones con timestamps |
| `DELETE /sessions/:id` | Cerrar sesión específica |

**Protocolo WebSocket (client → server):**

```json
{ "type": "input",  "content": "¿Cuál es la política de vacaciones?" }
{ "type": "abort" }
```

El servidor devuelve `AgentEvent` JSON frames: `token`, `tool_call`, `tool_result`, `agent_switch`, `done`, `error`, etc. — mismos eventos que `CallbackTransport`.

**Cliente HTML de prueba:** `client/index.html` — chat funcional vanilla JS, sin dependencias, sirve como referencia de implementación del protocolo.

---

### `@backendkit-labs/agent-web-ui` 0.1.0 — nuevo paquete

Template React para el template `chat` del scaffold enterprise.

**Stack:** React 18 + Vite + Tailwind CSS v4 + shadcn/ui + TypeScript

#### `useAgentSession` hook

```typescript
const {
    messages,      // ChatMessage[] — historial completo
    status,        // 'disconnected' | 'connecting' | 'connected'
    isRunning,     // true mientras el engine procesa
    activeAgent,   // { id, name, icon } del agente activo
    connect,
    disconnect,
    sendMessage,
    abort,
    clearMessages,
} = useAgentSession({ url: 'ws://localhost:3000/chat' });
```

Maneja el estado completo del stream: acumula tokens en el mensaje activo, actualiza badges de tool calls en tiempo real, detecta cambios de agente.

#### Componentes

| Componente | Descripción |
|---|---|
| `ChatWindow` | Área de scroll con auto-scroll al último mensaje |
| `MessageBubble` | Burbujas user/assistant con Markdown renderizado, cursor de streaming |
| `ToolCallBadge` | Badge animado: spinner → verde (ok) / rojo (error) |
| `InputBar` | Textarea auto-resize, Enter para enviar, botón Stop durante streaming |

#### `App.tsx` — template chat completo

- Header con badge del agente activo y estado de conexión
- Barra de URL colapsable para cambiar el servidor sin recompilar
- Dark theme por defecto (variables CSS de shadcn)
- `VITE_AGENT_SERVER_URL` env var para configurar el servidor en build

---

### Pilot enterprise — web server

`pilot/src/web-server.ts` — servidor de prueba que conecta el pilot vault con el browser:

```bash
PORT=4001 npm run web   # desde /pilot
# → abre http://localhost:5173 (Vite dev server)
```

Validado end-to-end: browser conecta por WebSocket, agente busca en vault con RAG, responde en streaming token a token, badges de tool call se animan en vivo.

---

## v0.21.0 (2026-06-10)

### `@backendkit-labs/agent-core` 0.20.2 → 0.21.0

#### Engine decomposition — god object eliminado

`AgentEngine` pasó de ~1350 a ~895 líneas. Cuatro módulos extraídos con responsabilidad única:

| Módulo | Responsabilidad |
|---|---|
| `HistoryManager` | Historial de mensajes: push, save, load, sanitize, trim |
| `AuditLogger` | Escritura de registros de auditoría en disco |
| `MCPRegistrar` | Estado MCP, init, registro de agentes/tools/triggers, routing |
| `ApprovalGate` | Decisión de aprobación de tool calls (3 branches → `check()`) |

#### Tests — red de integración del core

10 escenarios de integración nuevos sobre `AgentEngine` + `DelegationBus`:

| Test | Qué valida |
|---|---|
| `abort()` a mitad de ejecución | `sanitizeMessages` elimina chain incompleto; no hay 400 en el siguiente `run()` |
| 3 `ask_agent` en paralelo | `runParallel` ejecuta concurrente; resultados mapeados al `tool_call_id` correcto |
| Delegación anidada | `depth > 0` bypasea el bulkhead; no hay starvation con 6 slots |
| Dos `run()` concurrentes | Mutex serializa; historial no se corrompe |
| Historial con chain partido cargado de disco | Save + load round-trip produce historial válido |
| `toolTriggers` MCP sin permiso | Auth + approval aplican igual que para tools directas |
| Tool rechazada por `onToolApproval` | Mensajes de error correctos; audit con `success: false` |
| `maxIterations` en sub-agentes | Config respetada (no hardcoded 30) |
| Eventos paralelos por agente | Cada bloque `block_start…block_end` es contiguo por `agent_id` |
| `loadAgents` concurrente | Promise cache: una sola carga; ambos callers esperan |

Suite total: **294 tests** (293 en rama `refactor/engine-quality` + 1 fix post-merge).

#### QA flow — cobertura

`QAService` y `qa-orchestrator` ahora cubiertos:
- `countCodeLines`: 5 tests
- `evaluateReview`: 10 tests (todos los paths + patrones específicos + tiebreaker)
- `extractFindings`: 7 tests (bullet, numerado, severidades, fallback)
- `activateQaEngineerIfNeeded`: 7 tests
- `processQaEngineerResponse`: 6 tests

Fix: `'issues found'` eliminado de `REJECTION_PATTERNS` — era substring de `'no issues found'` y causaba falso positivo.

#### Fase 3 — strings al LLM unificados en inglés

Cero español en strings que entran al contexto del LLM:
- `AgentEngine`: headers de orquestación traducidos
- `qa-orchestrator`: prompt de activación del QA engineer traducido
- `QAService`: `APPROVAL_PATTERNS` / `REJECTION_PATTERNS` reorganizados (inglés primero, español como fallback para respuestas mixtas); system prompts, mensajes de usuario y headers de secciones traducidos
- `LessonsMemoGenerator`: headers de documento, secciones, tabla, checklist y todas las recomendaciones por `failureType` traducidos

#### Fase 4 — clasificación de subsistemas

Matriz de estado publicada en el README raíz. Tres niveles:

| Estado | Significado |
|---|---|
| **core** | Requerido para la historia enterprise — revisión completa ante cambios |
| **stable** | Funciona y se mantiene; no se expande durante el piloto |
| **experimental** | Congelado — `qa`, `reflection`, `agent-memory`, `observability`, `triggers` |

Regla durante el piloto: sin features nuevas en subsistemas `experimental`.

---

### `@backendkit-labs/agent-enterprise` 0.2.0 → 0.3.0

#### Nuevo export: `SimpleEmbedder`

```ts
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
```

TF-IDF con feature hashing (256 dims, djb2), sin dependencias externas, sin Ollama.
Ideal para desarrollo, CI y pilotos donde no hay GPU disponible.
Para producción usar `OllamaEmbedder` con `nomic-embed-text`.

---

### Pilot enterprise (`pilot/`) — no publicado

REPL interactivo que valida la historia enterprise de punta a punta:
- Vault compartido como fuente única de verdad (`pilot/vault/`)
- 6 notas seed: decisiones de arquitectura, patrones, lecciones, guía de arranque
- `npm run repl` — conversación libre con agente consultant + analyst
- `npm run smoke` — verifica indexado RAG + búsqueda + llamada LLM end-to-end
- `dotenv` — carga `.env` automáticamente al arrancar
- `SimpleEmbedder` — sin Ollama requerido para el piloto

Ciclo validado: humano documenta → LLM busca via RAG → agente responde con contexto real del negocio → agente escribe de vuelta → conocimiento disponible en el próximo turno.

---

### Docs

- `proyecto-agentes-web.md`: Principio rector 2 — vault como fuente única de verdad; §2.1 con diagrama del ciclo de aprendizaje colectivo y tabla agente genérico vs enterprise
- READMEs de paquetes: status header en `core`, `enterprise`, `coding`, `mcp-server`, `create-bk-agent`

---

## v0.15.0 (2026-06-04)

### Breaking changes — package rename

All packages now use the `@backendkit-labs` npm scope:

| Old | New |
|-----|-----|
| `@bk/agent-core` | `@backendkit-labs/agent-core` |
| `@bk/agent-coding` | `@backendkit-labs/agent-coding` |
| `@bk/mcp-server` | `@backendkit-labs/mcp-server` |

Migration:

```bash
npm uninstall @bk/agent-core @bk/agent-coding @bk/mcp-server
npm install @backendkit-labs/agent-core @backendkit-labs/agent-coding
```

Replace all imports:

```ts
// Before
import { ... } from '@bk/agent-core';
// After
import { ... } from '@backendkit-labs/agent-core';
```

### New

- `create-bk-agent` — interactive CLI scaffolder (`npx create-bk-agent my-project`)
- 5 starter templates: `coding`, `domain-agent`, `autonomous`, `mcp-server`, `minimal`
- `AgentEngine.updateWorkingDir(newCwd)` — live workspace switch without engine restart
- `/skills create` — scaffold a new skill file locally
- `/skills generate` — LLM-generate a skill from a description
- `/skills reload` — hot-reload skills without restarting
- `/skills uninstall` and `/skills update` — full skill lifecycle management
- `AgentEngine.callLLM(prompt)` — direct single-turn LLM call for slash commands

### Fixed

- `advanceRequiredGates`: only advances gates the task actually requires
- QA gate no longer records a false GO when no qa-engineer agent exists
- Policy engine used `architecture-agent`/`security-agent` IDs that did not match registered profiles — corrected to `architecture`/`security`
- `hasPassedGate`: replaced linear index comparison with FSM-semantics checks
- `computeKeywordScores`: capped at 15 to match confidence normalization denominator
- Workspace `add-app` now syncs `settings.cwd` when the new project becomes active

---

## v0.14.0 (2026-05-30)

- Skills hot-reload: `AgentEngine.reloadSkills()` resets YAML layer on next `run()`
- Orchestration: respect `requiresX` flags in gate advancement
- `matchesKeyword` deduplicated into `orchestration/keyword-match.ts`
- `AgentEngine.callLLM()` for raw single-turn LLM access from slash commands
- QA gate never auto-GO without a real reviewer