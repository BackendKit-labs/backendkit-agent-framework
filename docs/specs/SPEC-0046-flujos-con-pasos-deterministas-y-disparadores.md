# SPEC-0046: flujos con pasos deterministas (herramienta, lote, reintento) y disparadores

**Fecha:** 2026-11-25
**Estado:** **Borrador.** Sin código. Completa lo que la SPEC-0023 ya decidió y no llegó a implementar; las preguntas abiertas (§6) las responde el autor.
**Origen:** Steward (el producto que consume el framework) construyó su propio runner de workflows (`packages/workflow`, 1.767 líneas) y sus disparadores porque `core/flow` no podía ejecutar un paso como una llamada determinista a una herramienta. La comparación está en `docs/analisis-core-flow-vs-runner-de-hermes-2026-11-25.md` del repositorio de Steward. Petición del autor (2026-11-25): que Steward use el framework, **sobre lo que ya existe y sin crear más piezas**, y que **los flows actuales no se rompan**.
**Depende de:** [SPEC-0023](SPEC-0023-flujos-declarativos.md) (el motor de flujos: D2, F2, F6d), SPEC-0014 (`ToolPolicy`, `ApprovalStore`), SPEC-0044 (identidad), `agent-protocol` 1.2.
**Tipo de cambio:** **aditivo** en `core` (campos opcionales de `FlowStep`, un campo opcional en `StepOutput`, funciones puras de disparadores) y una batería de conformidad en `agent-core/testing`. Ningún campo existente cambia de significado.
**Objetivo:** que un flujo del framework pueda ser **el flujo de un producto contable** (pasos que son llamadas a herramientas con entrada tipada, lotes con aislamiento por elemento, reintentos, disparadores con franja estable), de modo que Steward retire su runner y conserve solo lo que es de su producto.

## 1. De dónde se parte (verificado el 2026-11-25)

- **La SPEC-0023 ya decidió el paso de herramienta y no se implementó.** D2 (Aceptada): «Tipos de paso: `agent`, `tool` y `gate`. Sin subflujos, bucles ni condicionales hasta que un caso real los pida». Su contrato (§4) incluye `kind?: 'agent' | 'tool' | 'gate'` y `tool?: { name; args? }`. El `FlowStepSchema` implementado (`packages/core/src/flow/types.ts`) solo tiene `id`, `agent`, `prompt`, `tools` (informativo), `after`, `when`, `gate` y `timeoutMs`: **no hay `kind` ni `tool`**. Los condicionales llegaron después (`when`, F6a); los bucles, no.
- **El caso real que D2 esperaba ya existe.** Los workflows contables de Steward (compra a pago, venta a cobro, cobros conciliados, la vigilancia de tesorería) llaman herramientas MCP de siete agentes deterministas, con datos tipados y dinero de por medio. Ahí un paso con un prompt y texto entre pasos no sirve.
- **El `trigger` ya está en la definición y nadie lo ejecuta.** `FlowTrigger` admite `queue`, `webhook`, `cron` y `manual`; el cargador valida `schedule` y `path`, y la SPEC-0023 (§4) dice «lo dispara la app; core solo lo declara». `TriggerManager` (`core/triggers`) es otra cosa: despierta a un agente **con modelo** con un prompt, sin id de corrida, sin identidad propia y sin recuperación de franjas.
- **Hermes ya es la app que dispara.** SPEC-0023 F6d: «Hermes sustituye `InProcessFlows`/`serveFlows` por los de core». Hermes no define flujos: los aloja el agente y él los supervisa. En Steward, además, Hermes **ejecuta** el workflow porque los agentes contables son servidores MCP sin flujo propio.
- **El Hermes de Steward es el Hermes del framework, con poco encima.** `packages/hermes` de Steward tiene exactamente los mismos archivos que `packages/hermes` del framework antes de salir (2026-10-26, `5d98c6b9`), con 7 archivos distintos y unas 160 líneas de diferencia (manifiesto exigido, departamento, `approvedBy`, `ProvisionContext`, `onRetired`, y los estados `awaiting_approval` y `lost` del protocolo 1.2). **No hay un segundo Hermes que reciclar:** la lógica de producto (disparadores, runner, aprobaciones por nivel, casos) vive fuera de ese paquete, en `apps/hermes-server`, `packages/workflow` y `packages/policy-engine`.
- **Lo que Steward tiene y `core/flow` no** (comparación del 2026-11-25): paso por herramienta con entrada tipada y expresiones sobre resultados estructurados; `forEach` con clave de idempotencia por elemento y tope; `retry` con espera; `onFailure: escalate`; disparadores `schedule`/`webhook` con identidad, id de corrida por franja, recuperación de la última franja y HMAC.
- **Lo que `core/flow` tiene y Steward no:** compensación declarada, journals SQLite/Redis/Postgres con `claim` renovable, `QueueStepExecutor` (BullMQ), `createFlowTools`.

## 2. Principios

1. **Un solo `FlowDefinition`.** No se crea un segundo formato de flujo. Lo nuevo son campos **opcionales** de la misma definición; un flujo que no los usa es idéntico al de hoy.
2. **Ningún flujo existente cambia.** Los YAML y los flujos construidos en código de `examples/flows`, `release-captain`, `portfolio-advisor`, `enterprise` y los de las guías siguen validando y ejecutándose igual. Criterio de aceptación: **los tests actuales de `core/flow`, `enterprise/flow`, `flow-queue` y `flow-sql` pasan sin tocarlos.**
3. **Core sigue sin conocer las herramientas.** Core no tiene un registro de herramientas ni de agentes: un paso de herramienta se ejecuta con un `StepExecutor` que pone el integrador, como hoy un paso de agente. La política, la identidad y la auditoría son del executor.
4. **Core define contratos y piezas puras; las apps son adaptadores** (SPEC-0023, principio 1). Por eso el servicio de disparadores (identidad, política, suspensión) **se queda en el host**; a core sube solo lo puro y sin E/S, que es donde viven los invariantes.
5. **Se reutiliza lo que hay.** Sin paquetes nuevos: `core/flow` para la definición y el motor, `core/testing` para la conformidad, `flow-sql`/`flow-queue` para el estado, y el mismo Hermes (sin un segundo plano de control).

## 3. Decisiones propuestas

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo es un paso de herramienta? | Se **implementa lo que D2 de la SPEC-0023 ya aceptó**: `kind?: 'agent' \| 'tool' \| 'gate'` (por defecto `agent`, como hoy) y `tool?: { name: string; args?: Record<string, unknown> }`. `agent` sigue diciendo **quién** lo ejecuta; `tool.name`, **qué llama**. Un paso `kind: 'tool'` no lleva `prompt`. El esquema pasa a una unión que **valida cada forma por separado**; los flujos de hoy (sin `kind`) validan sin cambios. |
| D2 | ¿Quién valida la entrada de la herramienta? | **El executor**, no core: core no conoce los esquemas. El `StepExecutor` recibe `{ tool, args }` ya resueltos y los valida contra el esquema de la herramienta (en MCP, el `inputSchema` que publica el servidor, o el que el manifiesto declare). Un `args` que no valida es un paso fallido con el motivo. |
| D3 | ¿Cómo se pasan datos entre pasos si hoy es texto? | `StepOutput` gana un campo opcional **`data?: unknown`** (el resultado estructurado). `content` sigue siendo texto y, para una herramienta, es `JSON.stringify(data)`: lo que ya lee cualquier consumidor actual no cambia. El journal guarda ambos. |
| D4 | ¿Cómo se refiere un paso a los datos de otro? | Un lenguaje de expresiones **pequeño, total y sin efectos** (sin bucles ni asignaciones) para `tool.args`, `when` y `forEach.items`: `$payload.x`, `$steps.<id>.data.a.b`, `$item`. Se propone **tomar el de Steward** (`packages/workflow/src/expr.ts`, 228 líneas, ya probado) en vez de diseñar otro. `{{payload.x}}` en los prompts y las condiciones `contains/equals/matches` **no cambian**. |
| D5 | ¿`forEach`? | D2 de la SPEC-0023 lo aplazó «hasta que un caso real lo pida»: **el caso existe**. Campo opcional `forEach: { items, key, max }` en un paso: la lista se toma **una vez** y se guarda en el journal (reanudar no la reevalúa), cada elemento es un paso hijo `<paso>[<clave>]` con su propia clave de idempotencia (`runId:paso[clave]:intento`), `max` es un tope que falla y no corta, y el paso padre termina cuando terminan todos. Con `onFailure: skip`, un elemento que falla no detiene a los demás. El journal ya guarda `steps` como `Record<string, …>`: admite claves nuevas (se verifica en F2). |
| D6 | ¿`retry` y `onFailure`? | `retry?: { max, backoffMs }` por paso, **solo con idempotencia** (la clave ya existe: `runId:stepId:attempt`). `onFailure?: 'abort' \| 'skip' \| 'escalate'` por paso; `onStepFailure` global sigue como defecto (`skip`/`continue`). `escalate` **no es un mecanismo nuevo**: deja el paso en `awaiting_approval` ante un rol, que es lo que ya hacen las aprobaciones (SPEC-0041). |
| D7 | ¿Quién ejecuta los disparadores? | **El host**, como ya dice la SPEC-0023. Core sube solo las **funciones puras** que hoy están en `triggers.ts` de Steward: calcular la **última franja** de un cron en una zona horaria dentro de una ventana (`latestSlot`), derivar el **id de corrida estable** de una franja o de un envío (`triggerRunId`), y firmar/verificar un **webhook** (`webhookSignature`, `verifyWebhook`, con tolerancia de reloj y comparación en tiempo constante). El servicio que arma esto con identidad, política y suspensión es del host (en Hermes). |
| D8 | ¿Y el período («el mes que se cierra»)? | El host, al disparar, pone en el `payload` un objeto **`trigger`** con `{ id, kind, firedAt, slot }` y, si el flujo declara cómo, el período derivado de la franja y la zona horaria. Se calcula **una sola vez al disparar** y se guarda en la corrida: reanudar o repetir ve el mismo valor. Se lee con `{{payload.trigger.period}}` y `$payload.trigger.period`. |
| D9 | ¿Un paso de aviso? | **Sin tipo de paso nuevo.** Un aviso es una llamada a una herramienta (`kind: 'tool'`) del host: Hermes ofrece una herramienta que deja un aviso en la bandeja de una persona o un rol. Se decide en el host qué datos puede llevar (importes y nombres son datos de negocio; ver el enmascarado del host). |
| D10 | ¿Cómo pasa Steward a usarlo sin riesgo? | Con una **batería de conformidad** `flowRunnerConformance` en `@backendkit-labs/agent-core/testing` (como `journalConformance`), escrita a partir de las pruebas del runner de Steward. Steward no sustituye su runner **hasta que el de core la pasa**. |
| D11 | ¿Qué se queda en Steward? | Lo que es del producto y core no debe conocer: los **tipos** de workflow según el nivel que permiten (`consulta`, `transaccional`…), los **parámetros por niveles** y el dinero en unidades menores, el **caso y la segregación de funciones**, las **aprobaciones por nivel 0 a 3 con prueba firmada que verifica el Ledger**, el catálogo firmado y la consola. Se enchufan como `approvals`, `gate` y `executor`, que ya son puntos de extensión de `runFlow`. |
| D12 | ¿Qué pasa con `WorkflowRunner`, `FlowRunner` y `orchestrator-agent`? | **Nada nuevo:** F7 de la SPEC-0023 los retira como obsoletos. Esta SPEC no los toca ni los reaviva. |

## 4. Lo que no hace

- **No crea un motor, un formato ni un paquete nuevos.** Amplía `core/flow` y su batería de pruebas.
- **No hace que core conozca herramientas, agentes ni esquemas de un dominio.**
- **No mueve el servicio de disparadores a core** ni le da identidad, política o suspensión: eso es del host.
- **No cambia el significado de nada existente.** Un flujo de hoy no nota la diferencia.
- **No trae a core los tipos de workflow, el caso, la segregación de funciones, las aprobaciones con prueba ni los parámetros por niveles** (D11).
- **No resuelve** la conciliación de las 6:00 de tesorería: necesita un extracto que ningún disparador trae (otra fuente de documentos, fuera de esta SPEC).

## 5. Fases

- **F1. Paso de herramienta (D1, D2, D3).** `kind`/`tool` en `FlowStepSchema` como unión, `StepOutput.data`, `StepInput` con la llamada resuelta, journals que guardan `data`. Prueba: todos los tests actuales de `core/flow` pasan sin tocarlos; un flujo con un paso `tool` pasa por un executor de prueba.
- **F2. Expresiones, `forEach` y `retry` (D4, D5, D6).** El lenguaje de expresiones en `tool.args`, `when` y `forEach.items`; expansión de lotes con claves y tope; reintento con espera; `onFailure`. Prueba: un lote donde un elemento falla no detiene los demás, y reanudar a mitad de un lote no repite los elementos hechos ni reevalúa la lista.
- **F3. Funciones puras de disparadores (D7, D8).** Las de `triggers.ts` de Steward, con sus pruebas, más el objeto `trigger` del `payload`. Prueba: las 8 pruebas del piloto de tesorería de Steward (`trigger-tesoreria.test.ts`) pasan usando las funciones de core.
- **F4. Conformidad (D10).** `flowRunnerConformance` en `core/testing`, desde las pruebas del runner de Steward.
- **F5. Steward consume (D11).** Su runner pasa a ser una capa delgada sobre `runFlow`, empezando por los workflows de solo lectura y terminando por los transaccionales. Se hace en el repositorio de Steward, con su propio criterio de aceptación: sus pruebas de flujo completo (compra a pago, venta a cobro, cobros conciliados) con agentes reales.
- **F6. Herramienta de aviso en Hermes (D9).** Fuera del framework.

## 6. Preguntas abiertas (las decide el autor)

1. **El lenguaje de expresiones (D4):** ¿se toma el de Steward tal cual (228 líneas, total y sin efectos), o se parte de `condition.ts` y se extiende? Recomendación: el de Steward, porque ya está probado con dinero de por medio y evita dos lenguajes.
2. **Dónde queda Hermes.** Es un solo código con dos copias: el del framework (npm `@backendkit-labs/hermes` 0.4.0, de `bk-platform` desde el 2026-10-26) y el de Steward (`@steward-agents/hermes` 0.1.0, con ~160 líneas más). ¿Cuál es el canónico? Opciones: (a) el de Steward, que se publica y se deja de mantener el otro; (b) se devuelve al otro el delta genérico (los estados `awaiting_approval` y `lost`, `onRetired`) y se queda en Steward lo de producto (manifiesto exigido, departamento, `approvedBy`). Esta SPEC funciona con las dos.
3. **Salida estructurada en el journal (D3):** ¿`data` se guarda tal cual o con la misma opción `redact` que el resto del journal? El resultado de una herramienta contable es dato sensible. Recomendación: `redact` también para `data`, sin valor por defecto, como hoy.
4. **`escalate` (D6):** ¿se modela como `awaiting_approval` ante un rol, o como un estado propio de «un resultado dudoso espera a una persona»? Steward lo usa cuando un proceso muere con un paso que cambia algo en marcha y nadie sabe si ocurrió.
5. **Versionado del formato:** ¿`FlowDefinition.version` sigue en 1 (todo es opcional) o se marca un `version: 2` para los flujos que usan los campos nuevos y que un lector antiguo debe rechazar en vez de ignorar? Ignorar un `forEach` sería ejecutar un paso una vez en vez de N: no es seguro. Recomendación: un lector que no conoce un campo de un paso **lo rechaza**, igual que el verificador de apoderamientos rechaza una restricción que no sabe aplicar (SPEC-0045).
6. **`kind: 'gate'`** (la SPEC-0023 lo nombra y hoy `gate` es un campo de un paso): ¿se completa aquí o se deja como está? Recomendación: dejarlo como está; no lo necesita ningún caso.

## 7. Riesgos

- **El journal con pasos que aparecen durante la corrida** (los elementos de un `forEach`). Steward lo resuelve con entradas «añadidas» en su journal; en el de core se verifica en F2 que `claim`, reanudar y los tres backends (`flow-sql`, `flow-queue`, NDJSON) lo toleran.
- **Una unión en `FlowStepSchema`** puede romper el tipo exportado `FlowStep` para quien lo usa en código. Se evita con un tipo base común y `kind` opcional; F1 lo comprueba contra los paquetes del monorepo.
- **El ciclo de publicación:** Steward depende de que el framework publique cada fase. Por eso F5 no empieza hasta que F4 existe, y su runner actual no se borra antes.
- **El coste de F2** (expresiones y lotes) es el más alto y el menos medido: son varios cientos de líneas ya escritas y probadas en Steward (el lenguaje de expresiones y la expansión de lotes de su runner), pero sobre otro journal.

## 8. Registro

- 2026-11-25: borrador. Petición del autor: flows existentes intactos, Steward sobre el framework, sobre lo que ya existe y sin crear más. Antes de escribirlo se verificó en el código que el paso de herramienta de SPEC-0023 D2 no está implementado, que el `trigger` solo se declara, y que el `packages/hermes` de Steward es el del framework con ~160 líneas más.
