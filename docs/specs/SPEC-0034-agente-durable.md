# SPEC-0034: bucle del agente reanudable (agente durable)

**Fecha:** 2026-11-17
**Estado:** Borrador. **Con criterio de entrada: no se empieza hasta que un caso real lo pida** (ver §3). Sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). El AI SDK de Vercel tiene `WorkflowAgent` (cada llamada de tool es un paso durable con reintentos); OpenAI Agents JS serializa un `RunState` para reanudar una ejecución; LangGraph guarda un checkpoint por superpaso.
**Depende de:** [SPEC-0004](SPEC-0004-agent-session.md) (log de sesión, borrador), [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) §6 (aprobación durable) y [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) D1 (que escogió reanudar por paso de flow antes que por turno).
**Tipo de cambio:** aditivo y opt-in, pero toca el centro de `AgentEngine`.
**Objetivo:** que un turno del agente con varias llamadas de tool sobreviva a la caída del proceso sin repetir los efectos ya hechos ni perder lo decidido.

## 1. De dónde se parte

Verificado el 2026-11-17:

- **El bucle del agente corre en memoria.** `HistoryManager` guarda el historial en un archivo JSON **al terminar la ejecución**, no durante ella (`save()`); una caída a mitad de un turno lo pierde, como ya señaló SPEC-0020 §1.
- **La aprobación durable ya existe, por reenvío** (SPEC-0014 §6, opción A): una llamada que pide aprobación queda pendiente en un `ApprovalStore`; cuando alguien decide, `engine.runApproved(id)` la ejecuta una sola vez repitiendo todas las comprobaciones. Cubre "esperar a una persona", **no** "el proceso murió".
- **Los flows ya son durables por paso** (SPEC-0023): journal, claim con renovación, reanudación sin repetir pasos hechos, `onInterrupted`. Un paso de flow es una conversación con un agente; si el proceso cae a mitad de ese paso, el paso se repite entero.
- SPEC-0014 §6.1 descartó suspender y reanudar el bucle "salvo que SPEC-0004 exista y aparezca un caso que el reenvío no cubra".

## 2. Evidencia en la competencia

- Vercel `ai` (commit `486e08f`, documentación `content/docs/03-agents/07-workflow-agent.mdx`): `WorkflowAgent` de `@ai-sdk/workflow` corre dentro de un workflow de Vercel; cada ejecución de tool es un paso durable con reintentos automáticos, lo que da reanudación y aprobaciones humanas. **Depende de la plataforma de workflows de Vercel**; no es un mecanismo autónomo.
- OpenAI Agents JS (commit `90a6b52`, `packages/agents-core/src/runState.ts`): un `RunState` serializable con **versión de esquema 1.25**, una clase de más de 4.000 líneas y reglas de propiedad de escrituras pendientes de sesión. Es la prueba de cuánto cuesta hacerlo bien dentro del propio bucle.
- LangGraph.js: un checkpointer por superpaso del grafo; funciona porque el bucle **es** un grafo.

## 3. Criterio de entrada

Esta spec **no se empieza** hasta que exista un caso que cumpla las tres cosas:

1. El agente hace varias llamadas con efecto externo en **un mismo turno**, no repartidas en pasos de un flow.
2. Repetir el turno entero tras una caída es inaceptable (cuesta dinero, duplica un efecto o pierde una decisión).
3. No se puede reescribir como un flow de varios pasos (si se puede, el flow ya lo resuelve con lo existente).

Si el caso aparece y se puede reescribir como flow, **se reescribe**. Esta spec existe para que, cuando haga falta de verdad, el diseño ya esté pensado.

## 4. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué granularidad? | **La llamada de tool:** se anota antes y después de cada una (`started`/`done`), junto con la respuesta del modelo que la pidió. Guardar cada token no tiene sentido. |
| D2 | ¿Dónde se anota? | En un **`TurnJournal`** con la misma forma que `RunJournal` (eventos de solo añadir, `claim`), implementado primero en memoria y ndjson; no es el log de sesión de SPEC-0004, que es mayor. |
| D3 | ¿Qué pasa con una tool con efecto que estaba en curso al caer? | **Queda `unknown` y no se repite sin una decisión**, como SPEC-0004 §2 y SPEC-0020 D3. Una tool `readOnly` o `idempotent` sí se puede repetir. Aprovecha las declaraciones de hechos que ya existen. |
| D4 | ¿Cómo se reanuda? | **Explícito:** `engine.resumeTurn(turnId)`, nunca automático (dos instancias podrían retomar el mismo turno). Toma el `claim` del turno. |
| D5 | ¿Qué se reconstruye? | El historial del turno hasta la última llamada hecha, tal como lo vio el modelo, más el resultado de cada tool. Las comprobaciones (`allowedTools`, política, aprobación) se **repiten** al reanudar, como en `runApproved`. |
| D6 | ¿Cuánto se guarda de las entradas y salidas? | Con `redact` obligatorio si se activa, sin valor por defecto: guardar el contenido de cada tool es guardar datos del usuario. |

## 5. Fases (solo si se cumple §3)

- **F0. Confirmar el caso** y medir cuánto costaría reescribirlo como flow. Si es menos que construir esto, parar.
- **F1. `TurnJournal` y escritura antes/después de cada tool,** sin reanudar todavía. Prueba: el journal de un turno de tres tools tiene seis anotaciones en orden.
- **F2. `resumeTurn` para tools `readOnly`/`idempotent`.** Prueba: se mata el proceso entre la segunda y la tercera tool; reanudar no repite la primera ni la segunda y termina el turno.
- **F3. Tools con efecto (D3).** Prueba: una tool con efecto interrumpida queda `unknown` y `resumeTurn` se detiene y pide decisión.
- **F4. Aprobaciones pendientes dentro de un turno reanudado.**
- **F5. Integración con SPEC-0004** (si ya existe) en lugar de un journal propio.

## 6. Criterios de aceptación

- Sin la opción activada, el engine se comporta idéntico a hoy y su suite no cambia.
- Reanudar nunca repite una llamada con efecto cuyo resultado ya está anotado.
- Ninguna comprobación de gobierno se omite al reanudar.

## 7. Riesgos

El riesgo es la complejidad: OpenAI necesitó un esquema versionado de miles de líneas para esto. Por eso el criterio de entrada es estricto y la granularidad (D1) es la mínima.
