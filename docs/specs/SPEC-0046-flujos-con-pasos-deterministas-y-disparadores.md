# SPEC-0046: flujos con pasos deterministas (el paso de herramienta) para que un producto use el framework

**Fecha:** 2026-11-25
**Estado:** **F1 implementada (2026-11-25), sin publicar.** Alcance reducido a lo mínimo por petición del autor («que no sea tan invasivo en el framework», 2026-11-25): lo demás queda **descartado a propósito** (§4) y se retoma solo si un segundo usuario del framework lo pide. Las seis preguntas del borrador se resolvieron con las recomendaciones (§6).
**Origen:** Steward (el producto que consume el framework) construyó su propio runner de workflows (`packages/workflow`, 1.767 líneas) y sus disparadores porque `core/flow` no podía ejecutar un paso como una llamada determinista a una herramienta. Comparación en `docs/analisis-core-flow-vs-runner-de-hermes-2026-11-25.md` del repositorio de Steward. Petición del autor: que Steward use el framework **sobre lo que ya existe y sin crear más piezas**, y que **los flows actuales no se rompan**.
**Depende de:** [SPEC-0023](SPEC-0023-flujos-declarativos.md) (el motor de flujos: D2, F2, F6d), SPEC-0014 (`ToolPolicy`, `ApprovalStore`), SPEC-0044 (identidad).
**Tipo de cambio:** **aditivo** en `core`: dos campos opcionales de `FlowStep`, uno de `StepOutput` y dos de `StepInput`. Ningún campo existente cambia de significado. `FlowStepSchema` sigue siendo un objeto.
**Objetivo:** que un flow del framework pueda tener un paso que **llama a una herramienta con argumentos estructurados y recibe un resultado estructurado**, sin que core conozca ninguna herramienta, de modo que Steward pueda ejecutar sus workflows de herramientas sobre `runFlow` en lugar de sobre su propio runner.

## 1. De dónde se parte (verificado el 2026-11-25)

- **La SPEC-0023 ya decidió el paso de herramienta y no se implementó.** D2 (Aceptada): «Tipos de paso: `agent`, `tool` y `gate`». Su contrato (§4) incluye `kind?: 'agent' | 'tool' | 'gate'` y `tool?: { name; args? }`. El `FlowStepSchema` implementado solo tenía `id`, `agent`, `prompt`, `tools` (informativo), `after`, `when`, `gate` y `timeoutMs`.
- **El caso real que D2 esperaba existe:** los workflows contables de Steward llaman herramientas MCP deterministas, con datos tipados y dinero de por medio; un paso con un prompt y texto entre pasos no sirve.
- **El `trigger` ya está en la definición y lo dispara la app** (SPEC-0023 §4: «core solo lo declara»). `TriggerManager` despierta a un agente con modelo: es otra cosa.
- **El Hermes de Steward es el Hermes del framework con poco encima:** `packages/hermes` de Steward tiene los mismos archivos que el del framework antes de salir (2026-10-26, `5d98c6b9`), con 7 archivos distintos y unas 160 líneas de diferencia. La lógica de producto (disparadores, runner, aprobaciones por nivel, casos) vive fuera de ese paquete. No hay un segundo Hermes que reciclar.

## 2. Principios

1. **Un solo `FlowDefinition`.** Los campos nuevos son opcionales; un flow que no los usa es idéntico al de hoy.
2. **Ningún flow existente cambia.** Criterio cumplido: los tests de `core/flow` (14 archivos, 227 pruebas), `enterprise` (244), `flow-queue` (58) y `flow-sql` (61) pasan **sin tocarlos**, y `enterprise`, `flow-queue`, `flow-sql`, `web`, `agent-protocol` y `mcp-server` compilan.
3. **Core sigue sin conocer las herramientas.** Un paso de herramienta lo ejecuta un `StepExecutor` que pone el integrador, como un paso de agente. La política, la identidad, la auditoría y la validación de los argumentos son del executor.
4. **Lo mínimo.** Nada de lo que Steward ya tiene resuelto (lotes, reintentos, expresiones, disparadores) se lleva a core ahora.

## 3. Lo que se hizo (F1)

| # | Decisión | Qué es |
|---|---|---|
| D1 | El paso de herramienta | `FlowStep.kind?: 'agent' \| 'tool'` (ausente = `agent`, como hoy) y `FlowStep.tool?: { name, args? }`. **`prompt` sigue siendo obligatorio** y en un paso de herramienta solo lo describe (el executor puede ignorarlo): así el tipo `FlowStep` y el esquema no cambian de forma, y no se rompe a nadie que lea `step.prompt`. `validateFlow` rechaza un `kind: 'tool'` sin `tool` y un `tool` sin `kind: 'tool'`. |
| D2 | Quién valida los argumentos | **El executor.** Core no tiene un registro de herramientas ni sus esquemas. |
| D3 | Resultado estructurado | `StepOutput.data?: unknown`. Si el executor da `data` y un `content` vacío, `content` es `JSON.stringify(data)`: el texto y el dato no pueden diferir. **No cambia el journal:** tras reanudar solo existe el texto, y el dato de un paso de herramienta se lee de él (`JSON.parse`). |
| D4 | Los datos llegan al paso siguiente | `StepInput.outputs?: Record<stepId, unknown>`: los resultados estructurados de los pasos de los que depende. El texto (`context`) llega igual que antes. |
| D5 | Los argumentos | `StepInput.tool = { name, args }` con `{{payload.x}}` ya resuelto en `args` a cualquier profundidad. **Una referencia entera conserva su tipo** (`"{{payload.amount}}"` es el número, no un texto); un texto más largo se interpola como un prompt; una ruta que no existe es `null`. |
| D6 | Expresiones sobre los resultados | **No hay.** Core no evalúa expresiones sobre `outputs`: eso es del executor. Steward conserva su lenguaje de expresiones y resuelve con él los argumentos que dependen de otro paso. `when` sigue mirando el texto. |

Archivos: `types.ts`, `loader.ts`, `interpolate.ts`, `run.ts`, y los dos `index.ts` (exports). Pruebas nuevas: `__tests__/tool-steps.test.ts` (13 casos: retrocompatibilidad, validación, la llamada resuelta, los datos entre pasos y la reanudación).

## 4. Lo que se descartó a propósito (por ser demasiado invasivo)

El borrador proponía más. Se **quita** y Steward conserva lo suyo:

| Quitado | Por qué | Consecuencia para Steward |
|---|---|---|
| Un lenguaje de expresiones en core (D4 del borrador) | Es una pieza grande y de dominio dudoso; el framework no la necesita para el paso de herramienta | Steward resuelve sus argumentos con su `expr.ts` dentro de su executor |
| `forEach`, `retry` y `onFailure: escalate` | Cambian el motor y el contrato del journal (pasos que aparecen en la corrida) | **Steward conserva su runner para los workflows que necesitan lotes o reintentos** (los transaccionales) |
| Funciones puras de disparadores (`latestSlot`, id de corrida por franja, firma de webhook) | Steward ya las tiene y funcionan; subirlas no le da nada hoy | Siguen en `apps/hermes-server`. Se suben si otro usuario del framework quiere ejecutar `trigger: cron` |
| La batería de conformidad `flowRunnerConformance` | Es trabajo de pruebas sin un segundo consumidor | Steward comprueba el paso de herramienta con sus propias pruebas de flujo completo |
| El período en el `payload` del disparador y un tipo de paso de aviso | Son del host | El aviso es una herramienta de Hermes (un paso `kind: 'tool'`); el período lo pone el host al disparar |

**Costo de esto, dicho claro:** el runner de Steward **no se retira** con esta fase. Steward ejecutará sobre `runFlow` los workflows de solo lectura y los que no necesitan lote ni reintento, y conservará su runner para el resto. Mientras `forEach` y `retry` no estén en core, hay dos motores en Steward (el del framework y el suyo).

## 5. Fases

- **F1. Paso de herramienta (hecha).** Lo de §3.
- **F2. Steward la usa** (en su repositorio): un executor sobre `runFlow` que ejecuta el paso de herramienta por Hermes (política, manifiesto, nivel, aprobaciones), empezando por los workflows `consulta`, como `vigilancia-tesoreria` y `prevision-caja`. Aceptación: sus pruebas de flujo completo con agentes reales.
- **F3. (solo si se pide)** `forEach`, `retry` y disparadores en core, con una SPEC propia.

## 6. Las seis preguntas del borrador, resueltas con las recomendaciones

1. **Lenguaje de expresiones:** el borrador recomendaba el de Steward en core. **Cambiado por la petición de no ser invasivo:** no entra en core (D6).
2. **Dónde queda Hermes:** se queda la copia de Steward; no se toca la del framework ni la de `bk-platform`. Devolver el delta genérico (los estados `awaiting_approval` y `lost`, `onRetired`) es opcional y no bloquea nada.
3. **`redact` sobre `data`:** no hay almacenamiento nuevo, así que no hay nada que enmascarar aparte; la opción `redact` existente sigue como estaba (la salida de un paso se guarda tal cual, sin valor por defecto).
4. **`escalate`:** fuera de esta fase (§4). Cuando se haga, será `awaiting_approval` ante un rol.
5. **Versionado y lectores antiguos:** el lector nuevo **rechaza** una combinación incoherente (D1). Un `agent-core` anterior **descarta `kind` y `tool`** al cargar (el esquema es un objeto que ignora los campos que no conoce) y ejecutaría el paso como un prompt. Es un riesgo conocido: un flow con pasos de herramienta debe cargarse con una versión que los conozca, y el CHANGELOG lo advierte. Endurecer el esquema (`.strict()`) rompería flows existentes con campos de más: no se hace.
6. **`kind: 'gate'`:** se deja como está. El esquema solo acepta `agent` y `tool`; un `gate` es hoy un campo de un paso.

## 7. Riesgos

- **Lectores antiguos** (pregunta 5): ejecutarían un paso de herramienta como un prompt. Mitigación: el rango de versión de `agent-core` que pide Steward, y el aviso del CHANGELOG.
- **El dato de un paso de herramienta tras reanudar sale de `JSON.parse` del texto.** Si el executor escribe en `content` algo que no es JSON, `outputs` no lo tiene tras reanudar. Contrato: un paso de herramienta devuelve JSON en `content` o `data`.
- **Dos motores en Steward** mientras no estén `forEach` y `retry` en core (§4).

## 8. Registro

- 2026-11-25: borrador. Verificado antes de escribirlo: el paso de herramienta de SPEC-0023 D2 no estaba implementado, el `trigger` solo se declara, y el `packages/hermes` de Steward es el del framework con ~160 líneas más.
- 2026-11-25: F1 implementada con el alcance mínimo, a petición del autor. Pruebas: `core/flow` 14 archivos y 227 pruebas, `enterprise` 244, `flow-queue` 58, `flow-sql` 61; compilan `enterprise`, `flow-queue`, `flow-sql`, `web`, `agent-protocol` y `mcp-server`.
