# Plan de mejora de diseño — agent-framework

Plan para corregir las cuatro debilidades estructurales identificadas en el análisis del core
(sesión 2026-06: análisis de multitarea, orquestación y MCP + 14 fixes ya committeados en
`16c9582`, `27ce100`, `0a592d2`, `5fe2d20`).

Orden de ejecución recomendado: **Fase 1 → 2 → 3 → 4**. La fase 1 (tests) va primero
deliberadamente: refactorizar el god object sin red de tests es repetir el problema que
originó los 14 bugs.

---

## Fase 1 — Red de tests del core engine

**Problema:** `AgentEngine.ts` (~1.400 líneas) concentra los caminos críticos del framework
y no tiene cobertura. Los 14 bugs corregidos vivían casi todos ahí; una suite de integración
los habría atrapado antes.

**Objetivo:** cubrir los caminos que ya demostraron ser frágiles, usando un `MockProvider`
(implementa `LLMProvider` con respuestas guionadas) y `CallbackTransport` para capturar eventos.

### Tests a escribir (en orden de valor)

| # | Escenario | Qué valida |
|---|---|---|
| 1.1 | `abort()` a mitad de ejecución de tools → siguiente `run()` | `sanitizeMessages` elimina el chain incompleto; no hay 400 |
| 1.2 | 3 `ask_agent` en un turno | `runParallel` ejecuta concurrente; resultados mapeados al `tool_call_id` correcto; output no entrelazado (buffers) |
| 1.3 | Delegación anidada (tool que llama `ctx.askAgent`) | `depth > 0` bypasea el bulkhead; no hay starvation con 6 slots ocupados |
| 1.4 | Dos `run()` concurrentes | El mutex serializa; el historial no se corrompe |
| 1.5 | Historial con chain partido cargado de disco | `saveHistory` + load round-trip produce historial válido |
| 1.6 | `toolTriggers` MCP con agente sin permiso | El trigger pasa por `executeToolCall`: auth + approval aplican |
| 1.7 | Tool no autorizada / `onToolApproval` reject | Mensajes de error correctos; audit con `success: false` |
| 1.8 | `maxIterations` en sub-agentes | `runAgentInternal` respeta la config (no 30 hardcoded) |
| 1.9 | Eventos por agente en paralelo | Cada bloque `block_start…block_end` es contiguo por `agent_id` |
| 1.10 | `loadAgents` concurrente | Promise cache: una sola carga, ambos callers esperan |

**Infraestructura:** `packages/core/src/__tests__/helpers.ts` ya existe — extenderlo con
`MockProvider` guionado (lista de turnos: cada turno declara `content` y/o `tool_calls`).

**Criterio de salida:** los 10 escenarios pasan y el coverage de `AgentEngine.ts` +
`DelegationBus.ts` supera el 70 % de líneas.

---

## Fase 2 — Descomponer el god object

**Problema:** `AgentEngine` mezcla loop de inferencia, QA, MCP registration, skills, historial,
audit y approval gates. Cada feature nueva interactúa con todas las anteriores.

**Objetivo:** extraer módulos con responsabilidad única, manteniendo la API pública del engine
intacta (los hosts no deben notar el cambio). Extraer en este orden — de menor a mayor riesgo:

### 2.1 `HistoryManager` (riesgo bajo)
- Mueve: `messages`, `loadHistory` (constructor), `saveHistory`, `clearHistory`, `trimHistory`,
  `sanitizeMessages`, `injectContext`.
- API: `push(msg)`, `getAll()`, `sanitizedSlice(n)`, `save()`, `clear()`, `trim(max)`.
- El engine pasa a delegar; `sanitizeMessages` deja de ser función suelta del módulo.

### 2.2 `AuditLogger` (riesgo bajo)
- Mueve: `writeAuditRecord` + creación del directorio en el constructor.
- API: `log(record): Promise<void>`. Permite testearlo aislado y cambiar el backend
  (archivo → stdout → OTLP) sin tocar el engine.

### 2.3 `MCPRegistrar` (riesgo medio)
- Mueve: `ensureMCPInitialized`, `registerMCPAgent`, `registerMCPToolPack`,
  `registerMCPAgentWrapper`, `unregisterMCPServer`, `findMCPRoute`, y los 4 mapas de estado MCP
  (`mcpTriggers`, `mcpToolTriggers`, `mcpAgentBlocks`, `mcpRegisteredServers`).
- Es el bloque más grande (~300 líneas) y el más autocontenido: solo necesita `agents`,
  `tools`, `transport` y el `MCPClientManager`.
- Aprovechar para el fix pendiente del análisis: **health-check de servers** — degradar el
  estado `connected` cuando un `callTool` falla por transporte, para que `reconnectFailed()`
  vuelva a intentarlo.

### 2.4 `ApprovalGate` (riesgo medio)
- Mueve: `requiresAlwaysAsk`, `ALWAYS_ASK_PATTERNS`, `WRITE_TOOLS`, `approvalDisabled`,
  y la lógica de decisión de `executeToolCall` (los 3 branches de approval).
- API: `check(call, profile): Promise<'run' | 'rejected'>`. `executeToolCall` queda en ~30 líneas.

### 2.5 QA flow (riesgo alto — evaluar si vale la pena)
- El bloque QA de `runLoop` ya está parcialmente extraído en `qa-orchestrator.ts`.
- Decisión pendiente: ¿el QA gate es parte de la historia enterprise o complejidad heredada?
  Si no se usa en el piloto, marcar como experimental y congelar en vez de refactorizar.

**Regla durante toda la fase:** un módulo por PR/commit, los tests de la Fase 1 verdes después
de cada extracción. No mezclar extracción con cambios de comportamiento.

**Criterio de salida:** `AgentEngine.ts` por debajo de ~600 líneas; cada módulo extraído con
su propio archivo de tests.

---

## Fase 3 — Unificar idioma

**Problema:** código, comentarios, errores y system prompts mezclan inglés y español.
Los system prompts en español degradan el rendimiento de modelos locales pequeños
(qwen, llama 8B), que rinden mejor instruidos en inglés.

**Decisión propuesta:** todo lo que ve el LLM o un consumidor externo → **inglés**;
lo que ve el usuario final de un agente enterprise → **configurable** (default español
para nuestro mercado).

| Capa | Idioma | Acción |
|---|---|---|
| System prompts internos (`buildOrchestrationBrief`, roster, QA) | Inglés | Traducir — afecta calidad de inferencia |
| Descripciones de tools (`search_knowledge`, `ask_agent`) | Inglés | Traducir — el LLM las lee |
| Comentarios y docstrings del código | Inglés | Traducir al tocar cada archivo (no big-bang) |
| Mensajes de error de cara al dev (`OllamaEmbedder`, CLI) | Español está bien | Mantener — el público inicial es hispanohablante; revisar si se publica en npm |
| Respuestas del agente al usuario | Configurable | Añadir `responseLanguage` al template enterprise (instrucción en el system prompt del orchestrator) |

**Criterio de salida:** cero español en strings que entran al contexto del LLM.
`grep -rn` de palabras clave (`Análisis`, `Contexto:`, `Busca información`) en `packages/core`
y `packages/enterprise` sin matches en prompts/tools.

---

## Fase 4 — Contener el scope

**Problema:** 10+ subsistemas a medio madurar (multi-agent, workflows, MCP×2, skills, memoria
avanzada, QA, triggers, observabilidad, CLI, RAG). Cada uno suma superficie de bugs y
mantenimiento. La historia vendible es una: **agentes enterprise 100 % locales**.

**Acciones:**

1. **Clasificar cada subsistema** en `core` (lo necesita la historia enterprise),
   `stable` (funciona, se mantiene, no se expande) y `experimental` (congelado,
   documentado como tal, puede romperse):
   - `core`: engine, providers (Ollama incl.), tools, delegación, RAG, CLI enterprise, MCP client.
   - `stable`: multi-agent template, workflows, skills, MCP server.
   - `experimental` (candidatos): memoria episódica/semántica, QA gates, triggers autónomos,
     observabilidad avanzada. Confirmar con el uso real del piloto.
2. **Marcar en el README** de cada package su estado — expectativas claras para cualquier usuario.
3. **Regla de oro hasta tener el piloto andando:** no se agregan features nuevas a subsistemas
   `experimental`. Toda capacidad nueva debe justificarse contra el caso de uso del piloto.
4. **Dejar que el piloto decida:** lo que el piloto use, se consolida; lo que no toque en
   un mes de uso real, es candidato a extraerse del core o eliminarse.

**Criterio de salida:** matriz de estado publicada en el README raíz; cero features nuevas
en subsistemas experimentales durante la fase del piloto.

---

## Secuencia y esfuerzo estimado

| Fase | Alcance | Esfuerzo relativo |
|---|---|---|
| 1. Tests del core | 10 escenarios + MockProvider | ●●○○ |
| 2. Descomponer engine | 4-5 extracciones incrementales | ●●●○ |
| 3. Unificar idioma | Prompts ya + código gradual | ●○○○ |
| 4. Contener scope | Clasificación + README | ●○○○ |

Las fases 3 y 4 pueden avanzar en paralelo con la 1 y 2 — son baratas y no tocan los
mismos archivos.

---

¿Armemos ese piloto con tu vault real como siguiente paso?
