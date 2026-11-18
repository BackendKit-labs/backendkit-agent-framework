# SPEC-0026: control de flujo en flows (reintentos por paso, foreach, repeat, sleep, waitFor)

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D7 con propuesta; sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). Mastra ofrece `foreach`, `dowhile`, `dountil`, `sleep`, `sleepUntil`, `waitForEvent` y reintentos por paso; nuestro paso no.
**Depende de:** [SPEC-0023](SPEC-0023-flujos-declarativos.md) (motor `runFlow`, journal, `FlowHost`) y [SPEC-0024](SPEC-0024-journal-de-corridas-ndjson.md) (journal ndjson).
**Tipo de cambio:** aditivo. Los campos nuevos son opcionales; un flow sin ellos corre igual que hoy.
**Objetivo:** que un flow pueda expresar sin código lo que hoy obliga a escribir un orquestador a mano: repetir sobre una lista, reintentar un paso que falla, esperar un plazo o un evento, y repetir hasta que una condición se cumpla.

## 1. De dónde se parte

Todo verificado en `packages/core/src/flow/` el 2026-11-17:

- `FlowStepSchema` (`types.ts`) tiene `id`, `agent`, `prompt`, `tools`, `after`, `when`, `gate`, `timeoutMs`. No hay bucles, esperas ni reintentos.
- `runFlow` (`run.ts`) ejecuta por **olas**: los pasos cuyos `after` están hechos corren juntos, con tope `maxConcurrency` (8) y los límites de `limiter`. Los pasos con aprobación humana van de uno en uno al final de la ola.
- `when` (`condition.ts`) omite un paso (`skipped`) con `contains`, `equals` o `matches` sobre la salida de un paso al que espera. Es la única ramificación.
- El journal guarda por paso `status`, `output`, `error`, `attempt`, `at`, `costUsd`. `attempt` ya entra en la clave de idempotencia (`runId:stepId:attempt`). `onInterrupted: 'retry' | 'fail'` reintenta un paso que quedó `running` al caer el proceso, pero **no** uno que falló.
- `interpolate.ts` solo resuelve `{{payload}}` y `{{payload.a.b}}`. Las salidas de pasos anteriores llegan al prompt como un bloque `[id]:\n<salida>` en `StepInput.context`, no por plantilla.
- `host.ts` reanuda corridas en espera de aprobación; **no hay temporizadores ni espera por evento**.
- La carga del YAML rechaza ciclos y referencias a pasos inexistentes (`loader.ts`). El `planner` genera flows con un modelo y los valida con el mismo esquema.

## 2. Evidencia en la competencia

Mastra (`packages/core/src/workflows/workflow.ts`, commit `35745537`): `sleep` (l. 2566), `sleepUntil` (2615), `waitForEvent` (2660), `parallel` (2848), `branch` (2893), `dowhile` (2958), `dountil` (3012), `foreach` (3066); `retries` como opción de paso. Pruebas que muestran qué casos borde cuidan: `sleep-id-determinism`, `cancel-sleep`, `foreach-failure-progress`, `foreach-suspend-payload`, `concurrent-resume`. Sus bucles viven en código TypeScript; el nuestro es declarativo (YAML), así que el diseño debe caber en datos.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Reintento por paso? | **Sí, `retry: { max, backoffMs }`.** Solo para un paso que falla (no `interrupted`). Cada intento incrementa `attempt` y cambia la clave de idempotencia. Sin `retry`, el comportamiento es el actual. `max` tiene tope (10). |
| D2 | ¿Cómo se repite sobre una lista? | **`foreach: { items, concurrency? }`.** `items` es una ruta del payload (`{{payload.files}}`) o el id de un paso del que depende, cuya salida es un array JSON. El paso se expande en instancias `id[0]`, `id[1]`... con `{{item}}` y `{{index}}` en el prompt. La salida del paso es un array JSON de las salidas. Tope `maxItems` (por defecto 100): más es un error, no un recorte. |
| D3 | ¿Cómo se repite hasta una condición? | **`repeat: { until: <condición>, max }`.** `max` es **obligatorio**: no hay bucles sin tope. La condición reutiliza `FlowConditionSchema` sobre la salida de la propia iteración. Cada iteración es `id#1`, `id#2`... en el journal. |
| D4 | ¿Cómo espera un plazo? | **Paso `sleep: { ms }` o `{ until }` (fecha ISO o `{{payload.fecha}}`)**, sin agente. Escribe `wakeAt` en el journal y la corrida pasa a un estado `sleeping`. **Nadie sostiene un temporizador en memoria**: el `FlowHost` abre un hilo de despertar opcional (`wakeEveryMs`) que reanuda las corridas con `wakeAt` vencido. Sin host, `runFlow` devuelve `sleeping` y quien llama decide cuándo reanudar. |
| D5 | ¿Cómo espera un evento? | **Paso `waitFor: { event, timeoutMs? }`**, resuelto con `host.signal(runId, event, data)`. Es la misma mecánica que la aprobación (la corrida queda en espera y se reanuda) con otra clave. Va en la última fase porque exige decidir la entrega de eventos. |
| D6 | ¿Las salidas de pasos se interpolan? | **Sí: `{{steps.<id>}}`** (la salida del paso, que debe estar en `after`). Hoy solo entra por `context`. Hace falta para `foreach` sobre la salida de un paso. |
| D7 | ¿Qué pasa con el `planner`? | **No genera `foreach`, `repeat` ni `sleep` por defecto** (un modelo no debe inventar bucles). Opt-in con `allowControlFlow`. |

## 4. Diseño

```yaml
flow: review-invoices
trigger: { type: manual }
steps:
  - id: fetch
    agent: collector
    prompt: List the invoices of {{payload.month}} as a JSON array.
    retry: { max: 3, backoffMs: 2000 }
  - id: check
    agent: auditor
    after: [fetch]
    foreach: { items: '{{steps.fetch}}', concurrency: 4 }
    prompt: Check invoice {{index}}: {{item}}
  - id: settle
    agent: treasury
    after: [check]
    repeat: { until: { step: settle, contains: PAID }, max: 5 }
    prompt: Try to pay the approved invoices. Say PAID when done.
  - id: cooldown
    after: [settle]
    sleep: { ms: 3600000 }
```

- Un paso con `sleep` o `waitFor` no lleva `agent` ni `prompt`: el esquema pasa a una unión discriminada por el tipo de paso. Los pasos de agente siguen siendo la forma por defecto.
- El journal usa ids derivados (`check[2]`, `settle#3`) y guarda el id del paso padre, de modo que las vistas agrupan las instancias.
- `FlowTransition` gana variantes para el inicio y el fin de cada instancia y para `sleeping`. Los consumidores que hagan un `switch` exhaustivo (Hermes, en `bk-platform`) deben tratar variantes desconocidas; se avisa en el CHANGELOG.

## 5. Fases

- **F0. Verificar y fijar el compromiso de compatibilidad.** Releer `run.ts`, `types.ts`, `loader.ts`, `adapter.ts` y `protocol.compat.test.ts`. Escribir la lista de consumidores del esquema (Hermes, `flowFromDefinition`, `createFlowTools`) y confirmar que añadir campos opcionales no rompe su prueba de compatibilidad.
- **F1. `retry` por paso (D1).** Prueba: un paso que falla dos veces y acierta a la tercera deja `attempt: 3`, la clave de idempotencia cambia en cada intento y el journal lo refleja; un `max` agotado falla el paso y respeta `onStepFailure`.
- **F2. `{{steps.<id>}}` (D6).** Prueba: la salida de un paso aparece en el prompt del siguiente; un id fuera de `after` es un error de carga.
- **F3. `foreach` (D2).** Prueba: 20 elementos con `concurrency: 4` nunca corren más de 4 a la vez, la salida es un array en orden, reanudar a la mitad no repite las instancias hechas, y 101 elementos fallan con `maxItems`.
- **F4. `repeat` (D3).** Prueba: termina al cumplirse la condición, y al llegar a `max` falla con un error claro; una caída a la mitad reanuda en la iteración correcta.
- **F5. `sleep` (D4).** Prueba con reloj simulado: la corrida pasa a `sleeping`, el host la despierta al vencer `wakeAt`, y cancelar durante la espera la cancela.
- **F6. `waitFor` (D5).** Prueba: `host.signal` reanuda una corrida en espera; un evento fuera de plazo falla el paso; una señal duplicada no ejecuta dos veces.
- **F7. Documentación.** Página de flows en la web, ejemplo en `examples/flows` y `planner` con `allowControlFlow`.

## 6. Criterios de aceptación

- Un flow antiguo, sin ningún campo nuevo, pasa todas las pruebas existentes sin cambios.
- Cada construcción nueva sobrevive a una caída del proceso y se reanuda sin repetir lo ya hecho, con `NdjsonRunJournal` y con `MemoryRunJournal`.
- Ninguna construcción puede correr sin tope: `foreach` tiene `maxItems`, `repeat` tiene `max`, `retry` tiene `max`.

## 7. Riesgos y fuera de alcance

- La expansión dinámica de pasos choca con la validación de ciclos y con las olas; el diseño debe validar el grafo **antes** de expandir y tratar las instancias como hojas de su padre.
- `FlowTransition` es un contrato con otro repositorio: ver F0.
- Fuera de alcance: `branch` (ya está `when`), subflows y mapeos de datos entre pasos distintos de `{{steps.<id>}}`.
