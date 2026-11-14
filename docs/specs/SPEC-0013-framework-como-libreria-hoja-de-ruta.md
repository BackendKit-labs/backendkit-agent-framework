# SPEC-0013: el framework como librería (hoja de ruta)

**Fecha:** 2026-11-14
**Estado:** Borrador
**Decide:** [ADR-0008](../adr/0008-core-define-contratos-verticales-y-apps-fuera.md)
**Depende de:** #166 y #167 (SPEC-0011 y bump v0.38.2) mergeados y publicados.
**Objetivo:** convertir el SDK en una librería de agentes limpia. Core define contratos genéricos; coding, negocio y las apps se enganchan desde fuera. Este documento es el índice: dice qué se hace, en qué SPEC y en qué orden, y guarda la lista de hallazgos para que no se pierda ninguno.

## 1. Tipos de agente y propiedades que la librería debe dar

| Tipo de agente | Propiedades necesarias |
|---|---|
| Conversacional o asistente | tools tipadas, memoria, contexto por capas, streaming, guardrails |
| Transaccional de negocio | hechos declarados en las tools, ejecución directa, política por cada llamada, aprobación durable, auditoría |
| Autónomo o en segundo plano | triggers, jobs, presupuesto, supervisión externa (`control`) |
| Multiagente | delegación con límites, workflow, contratos entre agentes |
| Servido como infraestructura | MCP cliente y servidor, `agent-protocol`, `web`, observabilidad exportable (`otel`) |
| Que ejecuta código u operaciones | sandbox, confinamiento de rutas y comandos |
| Todos | proveedores intercambiables, resiliencia, testabilidad (`testkit`), extensibilidad |

Las piezas que dan estas propiedades se quedan, aunque hoy no tengan consumidores (ADR-0008 §4).

## 2. Orden y SPECs

| Paso | SPEC | Tipo de cambio | Versión prevista |
|---|---|---|---|
| 0 | (sin SPEC) | Prerrequisitos (§4) | — |
| 1 | [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md): puntos de extensión del engine | Aditivo | core 0.38.x (minor) |
| 2 | [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md): extraer coding de los contratos de core | **Con ruptura** | core 0.39.0, coding 0.29.0 |
| 3 | [SPEC-0016](SPEC-0016-desamarrar-modulos-mixtos.md): desamarrar los módulos mixtos | Con ruptura (puede ir en el mismo minor que el paso 2) | core 0.39.0 |
| 4 | [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md): un contrato por concepto | Por fases, cada una aditiva con un periodo de obsolescencia | minors siguientes |
| 5 | [SPEC-0018](SPEC-0018-plantilla-de-agente-de-negocio-y-scaffolder.md): plantilla de agente de negocio y scaffolder | Aditivo; es la prueba de aceptación de los pasos 1 a 4 | create-bk-agent |

Un paso no empieza hasta que el anterior está mergeado. Los pasos 2 y 3 pueden compartir versión para concentrar las rupturas en un solo minor.

## 3. Trazabilidad: cada hallazgo y dónde se resuelve

Hallazgos verificados contra el código el 2026-11-14 (rama `release/core-0.37.2`).

### 3.1 Amarres en los contratos centrales

| # | Hallazgo | Dónde | Resuelve |
|---|---|---|---|
| A1 | `AgentEngineOptions` lleva `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA` y `onQAReview` | `engine/AgentEngine.ts:65-76` | 0015 F1 |
| A2 | El orquestador corre antes del loop e inyecta un brief en el system prompt | `AgentEngine.ts:526-541`, `:833-844` | 0014 (hook `systemPrompt`), 0015 F1 |
| A3 | QA corre al final del loop y puede forzar otra pasada (`continue`) | `AgentEngine.ts:1106-1133`, `engine/qa-orchestrator.ts` | 0014 (hook `afterTurn`), 0015 F1 |
| A4 | `qa-orchestrator.ts` y `package-install.ts` viven dentro de `engine` | `engine/` | 0015 F2 |
| A5 | `ApprovalGate` cablea `write_file`, `edit_file`, `run_command` y la detección de instalación de paquetes | `engine/ApprovalGate.ts:14`, `:72-83` | 0014 (regla por hechos), 0015 F3 |
| A6 | `onToolApproval(toolName, agentId, argsPreview: string)` no recibe principal ni hechos | `AgentEngine.ts:84`, `ApprovalGate.ts:6` | 0014 |
| A7 | `ExecutionContext` lleva `blockedCommands`, `additionalRoots` y `store: ProjectStoreData` | `types/index.ts` (ExecutionContext), `AgentEngine.ts:1548-1561` | 0015 F4 |
| A8 | `buildSystemPrompt` lee `store.getAgentNotes` (notas de sesión de coding) e instrucciones de rutas relativas de código | `AgentEngine.ts:819-830` | 0014 (hook `systemPrompt`), 0015 F4 |
| A9 | `AuditLogger` escribe hasta 200 caracteres de argumentos en claro y no es intercambiable | `engine/AuditLogger.ts` | 0014 (`AuditSink`) |
| A10 | `MCPServerConfig.blocksCommands` asume comandos de shell | `mcp/types.ts`, `engine/MCPRegistrar.ts:114,190` | 0015 F4 |
| A11 | `SkillActivator` detecta el stack por archivos de código y se ejecuta dentro de `run()` | `skills/activator.ts`, `AgentEngine.ts:505-521` | 0016 F2 |

### 3.2 Módulos mixtos (idea genérica + amarre)

| # | Módulo | Idea genérica | Amarre | Resuelve |
|---|---|---|---|---|
| M1 | `orchestration` (4,3k) | ciclo de vida de una tarea con gates, riesgo, enrutado | estados `design_review`/`qa_review`/`commit_*`, `ActionType` de coding, informes de auditoría de CI | 0015 F2 (se mueve entero a coding) |
| M2 | `reflection` (4,6k) | autoaprendizaje: aprender de fallos | dominios `audit/test/commit/agent/bootstrap`, `FailureRecord` con campos de auditoría de código, `.appName/manifest.yaml`, hook `.ps1`, `autoPromote` | 0017 F6 (núcleo genérico en core, **decidido**) + 0015 F2 (dominios de coding al vertical como plugin) |
| M3 | `qa` | revisión por un juez LLM | prompts de revisión de código | 0015 F2 |
| M4 | `context` | instrucciones por capas | `~/.appName`, `AGENT.md`, `USER.md` | 0016 F1 |
| M5 | `skills` | instrucciones empaquetadas, activación por disparador | detección de stack; fuentes GitHub, skills.sh y Obsidian en core | 0016 F2 |
| M6 | `commands/builtin.ts` (982 líneas) | `SlashCommandRegistry` | comandos de la app de terminal | 0016 F3 |
| M7 | `workspace`, `checkpoint`, `trust`, `bootstrap/GlobalSeed` | — | funciones de la app de terminal | 0016 F3 |
| M8 | `agent-discovery` | agentes como datos | estructura `~/.appName/agents` | 0016 F1 |

### 3.3 Conceptos duplicados

| # | Concepto | Implementaciones | Resuelve |
|---|---|---|---|
| D1 | Workflow | `core/workflow`, `enterprise/flow`, `coding/workflows/InitWorkflow`, planner y executor de `orchestrator-agent` | 0017 F1 |
| D2 | Política y aprobación | `orchestration/policy-engine`, `enterprise/policies` (seeder de notas), `ApprovalGate`, `ToolServerOptions.authorize` | 0014 (contrato), 0017 F2 |
| D3 | Auditoría | `AuditLogger`, `ToolCallRecord` del servidor de tools, `orchestration/audit`, `AuditEvent` de Steward | 0014 (contrato), 0017 F3 |
| D4 | Memoria | `SessionMemory`, `agent-memory` (`MemoryStoreBackend`), `ProjectStoreData`, `coding/store` | 0015 F4, 0017 F4 |
| D5 | RAG e indexado | `enterprise/rag`, lance-rag de `orchestrator-agent`, indexer de `mcp-server` | 0017 F5 |
| D7 | Autoaprendizaje | `reflection` (catálogo de fallos, patrones, promoción a regla, memo de lecciones) y `agent-memory/ProceduralMemory` (patrones `trigger → action → outcome` inyectados en el contexto) | 0017 F6 |
| D6 | `isLoopbackRequest` | core (`mcp/tool-server-http.ts`), `mcp-server/request-guards.ts`, `mcp-connectors/shared/server-runner.ts` | 0014 F0 (una sola copia en core) |

### 3.4 Pendientes sueltos de la sesión del 2026-11-14

| Pendiente | Dónde se registra |
|---|---|
| CI de `agent-web`: `cookie` ESM-only en `light-my-request` rompe Jest al instalar sin lockfile | §4 (prerrequisito) |
| Tests de `request-guards` fallan con `TMP` en formato 8.3 de Windows (`realpath`) | §4 |
| SPEC-0011 D5: migrar los 7 agentes de Steward a `createToolServer` | Aplazado por el usuario; se retoma después de 0014 para migrar una sola vez |
| Inventario de uso del 2026-11-14 | Nota del vault; ya no es criterio de decisión (ADR-0008 §4) |
| `orchestrator-agent` a bk-platform cuando migre a zod 4 | 0016 F3 (lo confirma como app) |

## 4. Prerrequisitos (paso 0)

1. Arreglar el job de tests de `agent-web` en CI. Dos opciones: `transformIgnorePatterns` o un override de `cookie` en `agent-web`, o quitar el `npm install --no-package-lock` del paso de rolldown. Va en un PR aparte.
2. Mergear #166 y #167 y publicar `agent-core` 0.37.2 y `mcp-server` 0.18.6, con sus tags.
3. Opcional: hacer que los tests de `request-guards` normalicen las rutas con `realpath` para que no dependan del formato de `TMP`.

## 5. Reglas para todos los pasos

- **Cada fase empieza por un test que falle** y cita `archivo:línea` verificado.
- **Cada interfaz nueva tiene dos implementaciones reales** antes de mergearse (ADR-0008, riesgo): normalmente el vertical de coding y Steward (este último validado en papel, porque su migración está aplazada).
- **Sin código muerto de compatibilidad.** Lo obsoleto se marca `@deprecated` con la versión de retirada y se quita en el minor siguiente.
- **Barrido de rangos** en cada minor: todos los `packages/*/package.json` y `packages/templates/**` (ver la memoria del procedimiento de release).
- **Documentación en el mismo PR:** README del paquete y CHANGELOG.

## 6. Fuera de alcance

- Migrar Steward (se hace después, una sola vez, sobre los contratos ya estables).
- Mover infraestructura entre repos más allá de lo ya decidido (`orchestrator-agent`).
- Cambiar proveedores o el formato de eventos del transport.

## 7. Decisiones abiertas (del usuario)

1. **Decidido (2026-11-14): opción A, reenvío.** La aprobación es genérica en qué se aprueba (cualquier acción) y en quién aprueba: una persona, otro agente o un servicio como Hermes. Hay cuatro reglas de seguridad: tipo aceptado, nadie se aprueba a sí mismo, un agente no aprueba más de lo que puede hacer, y todo queda auditado (SPEC-0014 §6).
2. **Decidido (2026-11-14):** el autoaprendizaje es una capacidad de core para cualquier agente, y los dominios de coding son un plugin (SPEC-0017 F6).
3. **Decidido (2026-11-14):** el vertical va en `agent-coding/pipeline` y la app de terminal en `agent-coding/cli` (SPEC-0015 §2, SPEC-0016 §1).
4. **Decidido (2026-11-14):** #166 se publica como está. La compatibilidad con Steward está verificada: 12 paquetes compilan contra el core nuevo (SPEC-0014 §8).
5. **Decidido (2026-11-14):** la regla por defecto es "lo que no es `readOnly` pide aprobación", y lo `destructive` nunca se aprueba en bloque (SPEC-0014 §4).
