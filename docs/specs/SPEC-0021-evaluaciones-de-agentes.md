# SPEC-0021: evaluaciones de agentes

**Fecha:** 2026-11-16
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar.
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
