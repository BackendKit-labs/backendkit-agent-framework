# SPEC-0015: extraer el vertical de coding de los contratos de core

**Fecha:** 2026-11-14
**Estado:** Implementado y publicado (#179, #180; core 0.39.0, agent-coding 0.29.0).
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (hooks, política, `AuditSink`) mergeado.
**Tipo de cambio:** **con ruptura.** Va en core 0.39.0 y agent-coding 0.29.0, con barrido completo de rangos.
**Objetivo:** que ningún contrato de core conozca el pipeline de coding. El pipeline sigue funcionando igual, enganchado desde el vertical mediante hooks y política.

## 1. Qué sale de core (verificado el 2026-11-14)

| Pieza | Ubicación hoy | Líneas | Destino |
|---|---|---|---|
| `orchestration/` completo (FSM, intent detector, risk scorer, policy engine, gate resolver, audit reporter, config loader) | `core/src/orchestration` | 4.307 | vertical de coding |
| `reflection/`: dominios (`audit`, `test`, `commit`, `bootstrap`, `agent`), hooks, `historical-loader`, `policy-promoter` a `manifest.yaml` y comandos de dominio | `core/src/reflection` | ~3.500 de 4.578 | vertical de coding, como plugin del autoaprendizaje. El núcleo (catálogo, detector de patrones, registro de dominios) se queda en core y se rediseña en SPEC-0017 F6 |
| `qa/qa-service.ts` | `core/src/qa` | 322 | vertical de coding |
| `engine/qa-orchestrator.ts` | `core/src/engine` | 234 | vertical de coding, reescrito como hook |
| `engine/package-install.ts` | `core/src/engine` | 111 | vertical de coding, como `ToolPolicy` |
| Opciones `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA`, `onQAReview` | `AgentEngineOptions`, `BaseEngineOptions` | — | se eliminan |
| `buildOrchestrationBrief` | `AgentEngine.ts:844` | — | hook `systemPrompt` del vertical |
| `WRITE_TOOLS` y `requiresAlwaysAsk` | `ApprovalGate.ts:14`, `:72-83` | — | `defaultToolPolicy` de core (regla "no `readOnly` ⇒ pedir aprobación", SPEC-0014 §4) + `packageInstallPolicy` de coding; las tools de lectura de coding declaran `readOnly: true` |
| Subpaths `./orchestration` y `./reflection` de core | `core/package.json` `exports` | — | se eliminan |

`enterprise` importa `agent-core/reflection` (2 imports): pasa al módulo de autoaprendizaje de core (SPEC-0017 F6). Si F6 aún no está, se mantiene el núcleo actual en core hasta que lo esté.

## 2. Ubicación del vertical (decidida el 2026-11-14: `agent-coding/pipeline`)

| Opción | Pros | Contras |
|---|---|---|
| Dentro de `agent-coding` (`agent-coding/pipeline`) | un paquete menos; coding ya depende de core | agent-coding crece cerca de 9k líneas; quien solo quiere las tools de archivos se lleva el pipeline |
| Paquete nuevo `agent-coding-pipeline` | `agent-coding` queda como tools y perfiles | un paquete más que versionar |

**Decisión del usuario:** subpath `agent-coding/pipeline` dentro del paquete existente. La app de terminal va en `agent-coding/cli` (SPEC-0016).

## 3. Limpieza de `ExecutionContext` y `AgentEngineOptions`

| Campo | Hoy | Después |
|---|---|---|
| `ExecutionContext.blockedCommands` | lo rellena el engine desde `AgentProfile.blockedCommands` (`AgentEngine.ts:1549`) | lo aplica la política del sandbox (`SandboxPolicy`) o una `ToolPolicy` de coding. El campo de perfil se mantiene como dato y lo lee la política de coding |
| `ExecutionContext.additionalRoots` | `AgentEngine.ts:1550` | pasa a la configuración del sandbox (raíces permitidas). `run_command` y las tools de archivos lo leen de `ctx.sandbox` |
| `ExecutionContext.store: ProjectStoreData` | notas de sesión de coding (`appendLearning`, `saveAudit`, `getAgentNotes`) | sale de core. El vertical lo inyecta vía `ExecutionContext.services` (ver abajo) y sus tools lo leen de ahí. `getAgentNotes` pasa a un hook `systemPrompt` |
| `MCPServerConfig.blocksCommands` | asume shell (`MCPRegistrar.ts:114,190`) | se generaliza a `blocksTools?: string[]`; `blocksCommands` se mantiene obsoleto y lo traduce el vertical |
| Párrafo "use RELATIVE paths" de `buildSystemPrompt` (`AgentEngine.ts:819-826`) | lo escribe core siempre que hay `workingDir` | hook `systemPrompt` de coding |

**Contrato nuevo mínimo:** `ExecutionContext.services?: ReadonlyMap<string, unknown>` con un helper tipado `getService<T>(ctx, key)`. Es la vía para que un vertical pase dependencias a sus tools sin añadir campos a core. Esto evita que el próximo vertical vuelva a pedir un campo propio.

## 4. Fases

- **F1. El pipeline como hooks.** Implementar en el vertical `codingPipelineHooks({ orchestrator, qaService, noQA, onQAReview })`, que devuelve `EngineHooks`: `beforeRun` llama a `orchestrate`, `systemPrompt` produce el brief y `afterTurn` hace lo que hoy hace `qa-orchestrator`, incluido `continue` con `qa-engineer`. Test: la suite actual del pipeline (`AgentEngine.orchestratorFailure`, `qa-orchestrator`, `fsm-*`) pasa con las opciones viejas sustituidas por los hooks.
- **F2. Mover los módulos.** `orchestration`, `reflection`, `qa`, `qa-orchestrator` y `package-install` al vertical, con sus tests. Core deja de exportarlos. `madge` sin ciclos.
- **F3. Aprobación por hechos.** Quitar `WRITE_TOOLS` de `ApprovalGate`; las tools de coding declaran sus hechos; `packageInstallPolicy` como `ToolPolicy` del vertical. Test: mismas preguntas de aprobación que hoy en el modo de iteración por defecto.
- **F4. `ExecutionContext`.** Tabla de §3, `services` y `getService`. Las tools de coding leen `store`, raíces y comandos bloqueados de su nueva ubicación.
- **F5. Release.** Barrido de rangos (paquetes y templates), CHANGELOG con guía de migración y bump de `create-bk-agent`.

## 5. Migración de consumidores

| Consumidor | Cambio |
|---|---|
| bk-coder-v2 (`orchestrator/src/executor.ts`) | `new Orchestrator` y `createBaseEngine({ orchestrator, qaService })` pasan a `hooks: codingPipelineHooks(...)`, con imports desde el vertical |
| `agent-coding` (`createCodingEngine`) | registra los hooks y las políticas por defecto. Para quien usa `createCodingEngine` el cambio no se nota |
| `enterprise` | import de `reflection` (ver §1) |
| Steward, bk-platform | no usan estas opciones; solo el barrido de rangos |
| Templates de `create-bk-agent` | se regeneran con la API nueva |

## 6. Criterios de aceptación

- Ningún archivo de `core/src` contiene `qa-engineer`, `write_file`, `run_command`, `commit_`, `design_review` ni rutas `.appName/manifest.yaml`. Se comprueba con un test que hace grep sobre el código fuente.
- `createCodingEngine` se comporta igual: la suite de coding pasa sin cambios de expectativas.
- Core baja cerca de 9.500 líneas.

## 7. Fuera de alcance

- Desamarrar `context`, `skills` y los comandos (SPEC-0016).
- Rediseñar el pipeline de coding: solo se mueve y se reengancha.

## 8. Estado y desviaciones (2026-11-15)

F1 a F4 estan hechas. Lo que se hizo distinto de lo escrito arriba:

| Punto | Spec | Hecho | Por que |
|---|---|---|---|
| `additionalRoots` | pasa a la configuracion del sandbox | **se queda** en `ExecutionContext` y en las opciones del engine | Lo usan `agent-coding` y `document-extract`; no es del pipeline de coding. Solo deja de incluir `store.projectDir`: lo anade `createCodingEngine`. |
| `blockedCommands` | lo aplica una politica | **va por `services`** (`coding.blockedCommands`); el campo de perfil sigue como dato | `run_command` ya lo comprobaba; la politica queda para SPEC-0016. |
| `store` | por `services` | por `services` (`coding.store`). `ProjectStoreData` y `SessionUpdates` pasan a `agent-coding` | Core ya no los exporta. |
| `services` | `ReadonlyMap` fijo | `Record` o funcion `(profile) => Record` | Una funcion permite valores distintos por agente (`blockedCommands`). |
| Regla de aprobacion legacy | "no `readOnly` => pedir" | **`readOnly: false` pide**; lo que no declara nada no pregunta | En la ruta `onToolApproval` sin politica, el cambio hubiera hecho preguntar a agentes que no son de coding. La ruta gobernada sigue con la regla de SPEC-0014. |
| `alwaysAsk` | no estaba | `ToolDefinition.alwaysAsk(args)` + `declaredAskPolicy` | Es el hecho con el que `run_command` declara los comandos de instalacion; core ya no conoce `package-install`. |
| `blocksTools` | generalizar `blocksCommands` | **no se hizo** | `blocksCommands` solo edita el dato `blockedCommands` del perfil, que se mantiene. Pendiente de SPEC-0016. |
| `reflection` | mover dominios, hooks, loader y promotor | se movieron dominios, hooks, `HistoricalLoader` y `LessonsMemoGenerator`; **el promotor se queda** | `ReflectionEngine` lo construye. Sale con el rediseño de SPEC-0017 F6. |
| Criterio de aceptacion del grep | cero coincidencias | un test con lista de excepciones | Quedan `GlobalSeed` y `stage-manifest` (SPEC-0016) y `reflection/` (SPEC-0017 F6). La lista solo puede encogerse. |
| Parrafo de rutas relativas y notas del agente | hook `systemPrompt` | `codingContextHooks` | Se anaden al final del prompt, no tras el directorio de trabajo. |

Cambios que rompen, para la guia de migracion de F5:
- Core: se quitan `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA`, `onQAReview`, `store` de las opciones; `ExecutionContext.store` y `.blockedCommands`; `ProjectStoreData`, `SessionUpdates`, `Orchestrator`, `QAService` y los tipos de orchestration; el subpath `agent-core/orchestration`; y el motor ya no pregunta por `write_file`, `edit_file` ni `run_command` por su nombre.
- Quien usaba esas opciones pasa a `hooks: [codingPipelineHooks({...})]`, importado de `@backendkit-labs/agent-coding/pipeline`.
- Una tool que antes preguntaba por llamarse `write_file` debe declarar `readOnly: false`.
