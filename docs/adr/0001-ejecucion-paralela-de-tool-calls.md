# ADR-0001: Ejecución paralela de tool calls

**Fecha:** 2026-10-21
**Estado:** Propuesto
**Spec:** [SPEC-0001 §3](../specs/SPEC-0001-agent-core-ola-1.md)

## Contexto
Cuando el modelo pide varias herramientas en un mismo turno, `AgentEngine.runLoop` las ejecuta una tras otra (`packages/core/src/engine/AgentEngine.ts:742-748`). Solo `ask_agent` corre en paralelo, vía `DelegationBus.runParallel` (Bulkhead de `@backendkit-labs/bulkhead`, 6 simultáneas por defecto, resultados en el orden de entrada). Los otros frameworks de agentes que comparamos (LangGraph, OpenAI Agents SDK, Claude Agent SDK, Vercel AI SDK) ejecutan en paralelo las llamadas independientes.

Restricciones que encontramos en el código:
- `ToolDefinition` (`core/src/types/index.ts:52-57`) y `defineTool` no tienen metadatos: no sabemos qué herramienta es segura de paralelizar.
- Las herramientas comparten estado mutable (`SessionMemory`, `store`, `memorySystem`) y no hay ninguna serialización.
- `ApprovalGate.check` no es seguro bajo concurrencia: un solo callback `onToolApproval` recibiría varias peticiones a la vez, el evento `tool_approval_request` no lleva id de llamada y `approve_all` es un booleano sin protección contra carreras.
- `ExecutionContext` no tiene `AbortSignal`: una herramienta en curso no se puede cancelar.
- Los resultados se asocian por `tool_call_id`, no por posición, así que el orden de ejecución no rompe a los providers; sí importa para que la salida sea determinista.

## Decisión
Paralelizar solo las herramientas marcadas explícitamente como seguras, con un límite de concurrencia, conservando el orden y la semántica de aprobación actuales.

1. **Metadato opt-in:** `ToolDefinition.concurrencySafe?: boolean`, por defecto `false`. `defineTool` lo acepta. Una herramienta segura es de solo lectura y no depende del orden respecto a sus vecinas.
2. **Planificación por olas:** los `otherCalls` del turno, en orden, se agrupan en olas. Las llamadas consecutivas con `concurrencySafe` forman una ola paralela (hasta `maxParallelTools`); una llamada no segura es una barrera y se ejecuta sola. El orden relativo entre barreras y olas se conserva.
3. **Aprobación primero y en serie:** `ApprovalGate.check` se ejecuta secuencialmente, en orden de llamada, antes de lanzar la ola. Las herramientas `concurrencySafe` no están en `WRITE_TOOLS`, así que normalmente no piden aprobación.
4. **Límite:** `maxParallelTools` (opción de `EngineOptions`, reenviada por `createBaseEngine` y `createCodingEngine`), por defecto `1` en la primera versión (comportamiento idéntico al actual). Se cambiará el default a `4` en una versión menor posterior, tras un periodo de uso. La implementación reutiliza el patrón Bulkhead de `DelegationBus` o un semáforo equivalente.
5. **Resultados y eventos:** los `tool_result` se empujan al historial en el orden original de las llamadas. Los eventos de cada llamada se acumulan en búfer (`executeToolCall` ya acepta un parámetro `emit`) y se vuelcan en orden al terminar la ola.
6. **Aborto:** `this.aborted` se comprueba antes de cada ola. Las herramientas en vuelo terminan (no son cancelables); sus resultados se guardan para que el historial no quede con `tool_calls` sin respuesta.
7. **Marcado inicial:** `read_file`, `list_directory`, `search_files`, `list_audits`, `get_latest_audit`, `memory_recall` y `memory_search_knowledge`. Todas las demás quedan en `false`. Las herramientas MCP quedan en `false`, salvo que su anotación `readOnlyHint` sea verdadera (a confirmar en la implementación).

## Consecuencias
### Positivas
- Menor latencia en turnos con varias lecturas (explorar un repo, buscar en varios archivos).
- Sin cambio de comportamiento por defecto: quien no active `maxParallelTools` no nota nada.
- Todos los agentes construidos sobre `AgentEngine` o `createBaseEngine` lo heredan al actualizar `agent-core`.

### Negativas / trade-offs
- El usuario ve los `tool_result` de la ola cuando termina la más lenta, no según van llegando.
- Una herramienta mal marcada como segura puede producir carreras sobre el estado compartido; la lista inicial es deliberadamente corta.
- Más superficie de pruebas (orden, abortos parciales, aprobaciones mezcladas).

## Alternativas consideradas
- **Paralelizar todas las herramientas:** descartada; las escrituras y `run_command` dependen del orden y comparten estado, y `ApprovalGate` no lo soporta.
- **Semáforo global sin metadato:** descartada; no resuelve qué es seguro, solo limita cuántas.
- **Dejar solo `ask_agent` en paralelo (estado actual):** descartada; las lecturas independientes son el caso más común y más barato de acelerar.
- **Volcar eventos según llegan:** descartada por defecto; entremezcla bloques en la UI. Queda como opción futura.
