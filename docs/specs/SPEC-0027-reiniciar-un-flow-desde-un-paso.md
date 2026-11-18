# SPEC-0027: bifurcar o reiniciar una corrida desde un paso

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). Mastra tiene `restart` y `timeTravel` en sus workflows; LangGraph, `getStateHistory` y `updateState` sobre sus checkpoints.
**Depende de:** [SPEC-0023](SPEC-0023-flujos-declarativos.md), [SPEC-0024](SPEC-0024-journal-de-corridas-ndjson.md). Se apoya, sin exigirlo, en [SPEC-0026](SPEC-0026-control-de-flujo-en-flows.md) (ids derivados de `foreach` y `repeat`).
**Tipo de cambio:** aditivo.
**Objetivo:** que una corrida terminada, fallida o a medias pueda **repetirse desde un paso concreto**, con la entrada de un paso corregida si hace falta, sin perder la corrida original ni su auditoría.

## 1. De dónde se parte

Verificado en `packages/core/src/flow/` el 2026-11-17:

- El journal es un **registro de eventos** (`JournalEvent`: `begin`, `step`, `update`) y `foldEvents` lo reduce a un `JournalRun`. `NdjsonRunJournal` (SPEC-0024) guarda un archivo por corrida, de solo añadir, con cadena de integridad.
- `runFlow` con un `runId` que ya existe **reanuda**: los pasos `done` no se repiten y su salida alimenta a los siguientes. No hay forma de volver a ejecutar un paso `done`.
- `begin` falla si el id ya existe. Una corrida cerrada (`done`, `cancelled`) devuelve su resultado sin ejecutar nada (`run.ts`, `fromJournal`).
- **El payload no se guarda**: el journal solo conserva `inputPreview`, cortado y enmascarado. Quien reanuda debe volver a pasarlo (`RunFlowOptions.payload`).
- La clave de idempotencia es `runId:stepId:attempt`.

## 2. Evidencia en la competencia

Mastra: `restart`, `timeTravel` y sus pruebas (`timetravel-divergence`, `timetravel-foreach`, `restart-mid-block`, `restart-completed-boundary`, `concurrent-time-travel` en `packages/core/src/workflows/`), commit `35745537`. LangGraph.js: el estado se guarda por superpaso en un checkpointer y se puede leer su historia y bifurcar (`libs/langgraph-core/src/pregel/index.ts`, `libs/checkpoint*`), commit `7257a24`. Ambos **mutan o continúan** la misma ejecución; nuestro journal encadenado pide otra cosa (D1).

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Se modifica la corrida original o se crea otra? | **Se crea otra (bifurcación).** La corrida original no se toca: su cadena de integridad y su auditoría siguen valiendo. La nueva lleva `parent: { runId, stepId }`. |
| D2 | ¿Qué hereda la bifurcación? | Los pasos anteriores al elegido, copiados como `done` con su salida. El paso elegido y todo lo que depende de él vuelven a `pending`. Los pasos independientes del elegido se **conservan**. |
| D3 | ¿Se puede corregir la salida de un paso antes de continuar? | **Sí, con `override: { stepId: output }`**, y queda escrito en el journal con quién lo hizo. Exige identidad (`by: Principal`); sin ella, no. Es el equivalente de `updateState`. |
| D4 | ¿Qué pasa con los efectos externos al repetir? | Cada paso repetido usa un `attempt` nuevo, así que **la clave de idempotencia cambia**: una tool idempotente por clave no se protege de la repetición, y es lo que se quiere. La bifurcación **vuelve a pedir las aprobaciones** de los pasos con `gate` repetidos (no se reutilizan). Se documenta que repetir un paso con efecto es una decisión consciente. |
| D5 | ¿Cómo se pasa el payload, si no está guardado? | **El llamador lo vuelve a pasar** (como al reanudar). Se añade a la bifurcación un `payload` opcional; sin él, los prompts con `{{payload...}}` reciben `null`, y se avisa. Guardar el payload entero queda fuera: lo prohíbe la regla de no almacenar datos sin `redact`. |
| D6 | ¿Quién puede hacerlo? | Una tool de `createFlowTools`, `flow_restart`, **con política `ask` humano por defecto**, y la función `forkRun` para el código. |

## 4. Diseño

```ts
interface ForkOptions {
  from: string;                              // id del paso
  newRunId?: string;
  override?: Record<string, string>;         // D3
  by?: Principal;                            // obligatorio si hay override
  payload?: unknown;                         // D5
}

forkRun(journal: RunJournal, runId: string, opts: ForkOptions): Promise<{ runId: string }>;
// Después: runFlow(def, { runId: <el nuevo>, journal, payload }) la ejecuta como a cualquier otra.
```

- `forkRun` no necesita métodos nuevos en `RunJournal`: lee con `get`, crea con `begin` (con `parent`) y copia los pasos con `step`. Hace falta un campo opcional `parent` en `NewJournalRun` y en `JournalRun`.
- La bifurcación y el original comparten `flow`; `runFlow` ya rechaza un `runId` que pertenece a otro flow.

## 5. Fases

- **F0. Verificar.** Confirmar que `get` devuelve las salidas completas de los pasos (no recortadas) en `Memory`, `File`, `Ndjson` y `Redis`; si alguno recorta, es un bloqueo. Comprobar cómo `FlowHost` y `createFlowTools` listan corridas para que una bifurcación no se confunda con otra.
- **F1. `forkRun` sobre pasos sin dependencias de ola** (lineal y diamante). Prueba: bifurcar en el paso 3 de 5 repite 3, 4 y 5, no toca el original y deja el hash del original igual que antes.
- **F2. `override` con identidad (D3).** Prueba: sin `by` falla; con él, queda el rastro en el journal y el paso siguiente recibe la salida corregida.
- **F3. Aprobaciones (D4).** Prueba: un paso con `gate` repetido pide aprobación otra vez, aunque la original estuviera aprobada.
- **F4. `flow_restart` en `createFlowTools`** con política `ask` humano. Prueba: un modelo que lo llama queda en espera; `approval_decide` no puede resolverlo (ya está denegado a `captain`).
- **F5. Con `foreach` y `repeat` de SPEC-0026** (si ya está): bifurcar dentro de un `foreach` repite solo las instancias afectadas.
- **F6. Documentación,** en la guía de flows de la web y en el ejemplo `release-captain`.

## 6. Criterios de aceptación

- La corrida original es idéntica antes y después de bifurcarla (con `NdjsonRunJournal`, su cadena verifica).
- Ninguna bifurcación ejecuta una tool sin pasar por política y aprobación como cualquier corrida.
- Quien repita un paso con efecto lo ve advertido en la documentación y en la salida de `forkRun`.

## 7. Riesgos y fuera de alcance

- Repetir un paso con efecto externo (un pago) es peligroso por naturaleza. Se mitiga con D4 y D6; no se elimina.
- Fuera de alcance: una interfaz para elegir el paso (es parte de [SPEC-0031](SPEC-0031-consola-de-desarrollo-local.md)) y mover una corrida entre journals.
