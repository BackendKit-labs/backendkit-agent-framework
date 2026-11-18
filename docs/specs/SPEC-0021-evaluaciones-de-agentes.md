# SPEC-0021: evaluaciones de agentes

**Fecha:** 2026-11-16
**Estado:** **En curso (2026-11-18): F0 a F5 hechas**, ver §8 y §9. Quedan la tanda de F2b y F6 de §7, sin hacer. Antes: borrador con decisiones D1-D7.
**Depende de:** `engine.run()` y `RunResult` (core, sin publicar), `agent-testkit` (`scriptedProvider`, `RecordingProvider`, `ReplayProvider`).
**Tipo de cambio:** aditivo, en `agent-testkit`. Core no cambia.
**Objetivo:** que un equipo pueda decir "este agente ahora lo hace mejor o peor" con números repetibles, y que una regresión rompa el CI sin llamar a un modelo.

## 1. De dónde se parte

- `engine.run()` devuelve un `RunResult`: por cada llamada a tool `name`, `agentId`, `success`, `errorCode`, `outcome` y `preview` (los primeros caracteres de lo devuelto), más el texto final, los errores, los prompts de sistema, `aborted` y `budgetExceeded`. **No trae los argumentos de cada llamada ni la salida completa**: un grader "`place_order` con `sizePct` ≤ 15" o "la salida contiene X" no se puede escribir hoy (D7).
- No hay semilla en el engine ni en `scriptedProvider`: la semilla del banco es del mundo simulado (el mercado), no del framework.
- `agent-testkit` graba y reproduce llamadas al modelo (`RecordingProvider`, `ReplayProvider` con inyección de fallos) y trae proveedores guionizados.
- El banco `trading-bot` (agent-framework-examples) ya hace una evaluación a mano: la misma semilla con y sin aprendizaje, con y sin aprobación, y una tabla. Escribió su propio bucle, su propia comparación y sus propias comprobaciones. Es la prueba de que falta la pieza.
- Falta: casos como datos, comprobaciones reutilizables, repeticiones, comparación entre dos configuraciones y un informe.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Qué es un caso? | (a) una función de test libre; (b) datos: `{ id, input, setup?, expect }` | **(b).** Los datos se pueden listar, filtrar, repetir y comparar; una función de test no |
| D2 | ¿Qué comprueba? | (a) solo graders deterministas sobre `RunResult`; (b) también un LLM como juez | **(a) por defecto, (b) enchufable.** Los deterministas (`toolCalled`, `toolNotCalled`, `noToolErrors`, `errorCode`, `textMatches`, `withinBudget`, `maxToolCalls`) son gratis y estables. El juez es una función `(caso, resultado) => Score` que aporta el integrador; el framework no trae uno propio |
| D3 | ¿Cuántas veces se ejecuta un caso? | (a) una; (b) `n` repeticiones, con semilla | **(b).** Un modelo real no es determinista: una sola ejecución no es evidencia. El informe da tasa de acierto, no un sí/no |
| D4 | ¿Cómo se comparan dos configuraciones? | (a) a mano; (b) `compare(a, b)` sobre los mismos casos y semillas | **(b).** Es lo que el banco hizo a mano (con y sin aprendizaje). Devuelve la diferencia por caso y total, con el número de ejecuciones para que se vea cuánto pesa |
| D5 | ¿Cómo corre en CI sin modelo? | (a) solo en vivo; (b) con grabaciones reproducidas; (c) ambas | **(c).** `replay` para regresiones de plomería (gratis, estable) y en vivo bajo demanda con tope de gasto (como `live.ts` del banco) |
| D7 | ¿Qué hace falta en `RunResult` para evaluar? | (a) nada; (b) `args` opcional por llamada, activable con una opción (`recordArgs`) | **(b).** Los argumentos pueden llevar datos sensibles y hoy solo se guarda su hash; por eso es opt-in y se usa en pruebas. Cambio aditivo en core |
| D6 | ¿Dónde vive el informe? | (a) consola; (b) JSON versionable; (c) interfaz | **(b).** JSON con esquema versionado y un resumen en consola. La interfaz queda fuera: cualquiera la construye sobre el JSON |

## 3. Diseño

```ts
interface EvalCase {
  id: string; input: string;
  /** Prepara el mundo del caso (archivos, estado del broker...) y devuelve lo que `expect` necesite. */
  setup?: () => Promise<unknown> | unknown;
  expect: Grader[];
  tags?: string[];
}
type Grader = (r: RunResult, ctx: { setup: unknown }) => { pass: boolean; score?: number; note?: string };

evalSuite({ name, cases, build: (c: EvalCase, run: { repetition: number; seed: number }) => AgentEngine, repeat?: number, seed?: number, spendCap?: number }): Promise<EvalReport>
compare(a: EvalReport, b: EvalReport): Comparison
```

- `build` recibe el caso y el número de repetición con su semilla, y devuelve el engine: el integrador decide el proveedor (real, guionizado o reproducido), qué módulos activa (aprendizaje, memoria) y qué hace con la semilla (por ejemplo, sembrar el mercado simulado). El framework solo la reparte.
- `spendCap` se apoya en `engine.budgetExceeded`: la suite se detiene y lo dice en el informe, no lo oculta.
- Los resultados guardan el `RunResult` de cada ejecución para poder revisar un fallo. No hay redactor en el framework: el informe puede contener `preview`, texto y (con D7) argumentos, y hay que tratarlo como dato sensible.

## 4. Fases

- **F0. `args` opcional en `RunResult` (D7).** Test: con `recordArgs` cada llamada trae sus argumentos; sin la opción, no.
- **F1. Casos, graders deterministas y `evalSuite`.** Test de aceptación: una suite de tres casos con un proveedor guionizado da el informe esperado, byte a byte.
- **F2. Repeticiones y `compare`.** Test: dos configuraciones con tasas distintas sobre las mismas semillas dan la diferencia correcta y el número de ejecuciones.
- **F3. Informe JSON versionado y resumen en consola.**
- **F4. Suites con grabaciones.** `evalSuite` acepta una grabación por caso. Test: una regresión introducida a propósito (una tool deja de llamarse) rompe la suite sin red.
- **F5. Migrar el banco `trading-bot`** a la suite, como caso de uso y prueba de que la API alcanza.

## 5. Criterios de aceptación

- Una suite es repetible: misma semilla y mismo proveedor guionizado dan el mismo informe.
- Una regresión de comportamiento (una tool llamada de más, un código de error nuevo) rompe una suite en CI sin llamar a un modelo.
- El informe dice cuántas ejecuciones hubo y si el gasto se cortó.

## 6. Fuera de alcance

- Un modelo juez propio del framework.
- Panel web de resultados.
- Evaluación de la calidad del texto (estilo, tono): depende del dominio.
- Conclusiones estadísticas (intervalos, significancia). El informe da conteos; interpretarlos es del equipo.

## 7. Aportes de la comparación con otros frameworks (2026-11-17, [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md))

Mastra (commit `35745537`) tiene `packages/core/src/evals` (scorers de código, de LLM y prebuilt), `datasets` (conjuntos de casos y experimentos) y `evals/scoreTraces` (puntuar trazas ya guardadas). Lo que ya está aquí (casos como datos, graders deterministas, repeticiones, `compare`) coincide con su diseño. Dos cosas suyas no están en D1-D7:

| # | Pregunta | Propuesta |
|---|---|---|
| D8 | ¿Un caso puede sustituir tools por respuestas fijas? | **Sí: `toolMocks` en el caso.** Mastra lo hace con `datasets/experiment/tool-mocks.ts`: cada mock nombra una tool y sus argumentos (`match: 'strict'` por igualdad profunda o `'ignore'` solo por nombre) y entrega una salida **en lugar de ejecutar la tool real**. Aquí se implementa con el hook que corta antes de ejecutar una tool (SPEC-0014), así que una prueba no necesita un mundo simulado entero. Solo salidas, no errores, en la primera versión. |
| D9 | ¿Se puntúan trazas guardadas en lugar de ejecutar de nuevo? | **Después de F4, opcional.** Con `recordArgs` (D7) y el audit, se puede evaluar lo que un agente ya hizo en producción sin volver a llamar al modelo. Hace falta una decisión de privacidad antes (qué se guarda y con qué `redact`). |

Se añade a las fases: **F2b** (`toolMocks`, con su prueba: una suite con una tool simulada no ejecuta la real) tras F2, y **F6** (puntuar trazas) como opcional tras F5.

## 8. Implementación (2026-11-18)

**F0.** `recordArgs` en el engine (`createBaseEngine({ recordArgs: true })`): cada `RunResult.toolCalls[]` lleva `args`. Van **solo al resultado**, no al evento `tool_result`: ningún transporte los recibe (el recolector los guarda aparte, por identidad del evento). Sin la opción no hay `args`: pueden llevar datos sensibles y la auditoría solo guarda su hash. Ojo: el evento `tool_call`, anterior a esto, ya muestra los 200 primeros caracteres de los argumentos (`args_preview`) con o sin la opción. 4 pruebas en core, incluidas las de una tanda paralela y un delegado, que conservan cada uno sus argumentos.

**F1 a F3.** `agent-testkit`: `evalSuite`, `compare`, `formatReport`, `formatComparison`, `writeReport`, `readReport`, `grader` y los graders `toolCalled` (con `times` y `with` sobre los argumentos), `toolNotCalled`, `noToolErrors`, `errorCode`, `textMatches`, `withinBudget` y `maxToolCalls`. Informe JSON con `schema: 1`; `writeReport` lo guarda (archivo `0o600`, crea la carpeta) y `readReport` lo lee y rechaza otra versión. 15 pruebas en el testkit, con un engine real sobre un proveedor guionizado: informe esperado, informe idéntico byte a byte en dos ejecuciones, una regresión que rompe la suite sin modelo, `setup`, etiquetas, semillas, repeticiones, una corrida que lanza, corte por presupuesto, graders con y sin `recordArgs`, y `compare`.

**F4.** No hizo falta código: `build` devuelve el engine, así que una grabación por caso es un `ReplayProvider` dentro de `build`. La regresión en CI sin red se prueba con un proveedor guionizado (F1); con una grabación real es lo mismo.

**Diferencias con el diseño de §3**
- **`spendCap` (un número de dólares) no se hizo:** el engine no expone una API de coste que la suite pueda leer. En su lugar `stopOnBudget` (por defecto `true`): la suite se detiene cuando una corrida informa `budgetExceeded` (el presupuesto del propio engine) y el informe dice `stoppedEarly: 'budget'`.
- **`includeTiming`:** la duración y la hora de inicio se omiten por defecto para que la misma suite dé el mismo informe.
- **`EvalRunInfo.setup`:** `build` recibe también lo que devolvió el `setup` del caso.
- **Un grader sobre argumentos sin `recordArgs`** falla diciéndolo, no pasa por accidente.
- **Sin repetición ni conteo por grader en `compare`:** compara tasas de acierto por caso y en total (sobre los casos que tienen los dos informes), con el número de corridas de cada lado.

**Sin comprobar:** con un modelo real (las pruebas usan proveedor guionizado: prueban el arnés, no la calidad de ningún agente); que la API alcance para un caso real (F5, §9: alcanza con un adaptador, y destapó un hueco); que `compare` baste sin intervalos de confianza (fuera de alcance por diseño). Sin publicar: va en el próximo release de `agent-core` y `agent-testkit`.

## 9. F5: el banco `trading-bot` con la suite (2026-11-18)

`agent-framework-examples/trading-bot/src/evals.ts` (`npm run evals`), sin red ni modelo: el trader simulado que pide el 40 % de la equidad. Pregunta: ¿aprender de un rechazo cambia lo que hace el bot? Un caso, dos graders (como mucho 3 órdenes rechazadas en la corrida; ninguna en el último tercio), 4 semillas por configuración, 180 barras:

| Configuración | Corridas que pasan | Órdenes rechazadas (primera corrida) |
|---|---|---|
| Sin aprendizaje | **0 de 4** | 18 |
| Aprendizaje y aprobación | **3 de 4** | 7 |

`compare` da 0 % a 75 % (+75 %, 4 corridas por lado). Es lo que el banco hacía a mano con su propio bucle, ahora con la suite.

**Lo que mostró:**
1. **La API alcanza, pero solo con un adaptador.** La unidad de la suite es **una** llamada a `engine.run`. Una simulación es un **episodio**: un engine durante cientos de barras, en un mundo que se mueve. Cada corrida aquí es una simulación entera envuelta en un objeto con `run` que devuelve lo ocurrido como un `RunResult` (las llamadas a tools de todas las sesiones). La suite solo necesita `run`, así que funciona sin cambios. Pero los graders ven un resultado agregado y no una sesión: no pueden preguntar "en la barra 120, ¿qué hizo?". Un episodio como ciudadano de primera (varias entradas por corrida, graders por turno) **no existe** y no se construye sin otro banco que lo pida.
2. **Mismo resultado que el banco a mano**, y la comparación sale en una línea.
3. **No se probó con un modelo real:** el trader es un mock.

**Arrastrado por la eliminación de `FileRunJournal` (#243):** `desk-journal-bench.ts` y `desk-smoke.ts` del banco dejaron de compilar y se migraron a `NdjsonRunJournal`. Un check no fue un cambio de nombre: simulaba un proceso muerto **dentro del mismo proceso** con un claim de TTL de 50 ms, y `NdjsonRunJournal` libera el claim por el pid de su dueño (ignora el TTL), así que aquel pid, vivo, no se relevaba. Ese check usa ahora `MemoryRunJournal`; la caída real se prueba con procesos separados (core, `audit-desk`). Los 11 checks de `desk:smoke` pasan.
