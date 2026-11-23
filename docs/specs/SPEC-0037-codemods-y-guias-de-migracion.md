# SPEC-0037: codemods y guías de migración

**Fecha:** 2026-11-17
**Estado:** **El paquete `codemod` está retirado (2026-11-23).** Se borró del repositorio y su CI; el paquete publicado (`@backendkit-labs/codemod` 0.1.0) queda deprecado en npm, sin usuarios. No se hacen F2 ni el resto de F3. La guía de migración se reescribió sin el codemod: dice qué cambiar a mano en cada ruptura. Lo que sigue vigente es la guía de migración (F4) y la regla de que una ruptura sale con su guía. Antes: **F0 hecha (2026-11-18)**: inventario de las rupturas reales, ver §8. **F1 hecha (2026-11-18)**: el paquete, `--list`, `--dry-run` y cuatro transformaciones (`scope-rename`, `coding-split`, `terminal-app-split`, `zod4-record`), ver §9; la herramienta final es el compilador de TypeScript, no `ts-morph`. **Probado con un proyecto real (`aiops-agent`), ver §10.** **F4 hecha (2026-11-18)**: guía `guides/migrate-between-versions` en la web, ver §12. F2 y el resto de la parte de zod 4 de F3 sin hacer.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). El AI SDK de Vercel y Mastra publican un paquete `codemod` y guías de migración por versión; nosotros hemos publicado rupturas con solo una nota en el CHANGELOG.
**Depende de:** nada. Aditivo, en un paquete nuevo.
**Tipo de cambio:** aditivo.
**Objetivo:** que quien usa el framework migre una ruptura con una orden y una guía, en lugar de leer el CHANGELOG y editar a mano.

## 1. De dónde se parte

Verificado el 2026-11-17:

- El `CHANGELOG.md` marca las rupturas con "**Con ruptura**" o "Breaking": SPEC-0015 F1–F4 (el pipeline de coding sale de `agent-core`, #179), SPEC-0016 F1–F3 (la app de terminal sale de `agent-core`, #182), la migración a zod 4 (los esquemas de `defineTool` y `generateObject` deben ser de zod 4) y un renombrado de paquetes.
- Cada ruptura obligó además a un **barrido de rangos 0.x** en los `package.json` (en 0.x, `^0.39` no cubre `0.40`), documentado en el procedimiento de release y hecho a mano con scripts.
- No hay guía de migración por versión en la web ni en `docs/`, ni un binario que transforme código.
- El scaffolder `create-bk-agent` ya modifica proyectos (`create-bk-agent add testing`), así que hay un precedente de "orden que edita un proyecto".

## 2. Evidencia en la competencia

Vercel `ai` (commit `486e08f`): `packages/codemod` ("Automated migrations for major releases", según su `AGENTS.md`) y `content/docs/08-migration-guides`. Mastra (commit `35745537`): `packages/codemod`. En ambos, cada ruptura trae una transformación y una guía.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Dónde vive? | **`@backendkit-labs/codemod`** con una orden `npx @backendkit-labs/codemod <transformación> [ruta]`. Un paquete aparte para no engordar el SDK. |
| D2 | ¿Con qué herramienta? | **`ts-morph`** (el AST de TypeScript con una API cómoda): reescribe imports, nombres y llamadas respetando el formato. Alternativa: `jscodeshift`. F0 prueba ambas con la primera ruptura real. |
| D3 | ¿Qué se transforma? | Solo lo **mecánico y seguro:** cambios de import (de `@backendkit-labs/agent-core` al paquete nuevo de coding), renombrados, y los rangos de `package.json`. Lo que exige criterio (la migración de esquemas a zod 4 con `.refine` o `.transform`) se **avisa y se deja marcado** con un comentario `// TODO(codemod)`, no se adivina. |
| D4 | ¿Cómo se prueba? | Cada transformación tiene **un par de carpetas** `antes/` y `después/` y una prueba que ejecuta la orden y compara, más la comprobación de que correrla dos veces no cambia nada (idempotente). |
| D5 | ¿Y la guía? | Una página por ruptura en la web ("Migrating to 0.40") con lo que cambió, la orden, y lo que queda a mano. **Se escribe junto a la ruptura**, no después: pasa a ser parte de la lista de cierre de un release con ruptura. |

## 4. Diseño

```bash
npx @backendkit-labs/codemod coding-split ./src        # SPEC-0015: imports de coding
npx @backendkit-labs/codemod terminal-app-split ./src  # SPEC-0016
npx @backendkit-labs/codemod bump-ranges .             # barrido de rangos 0.x en package.json
npx @backendkit-labs/codemod --list                    # transformaciones disponibles, con la versión que las pide
```

- `--dry-run` muestra el cambio sin escribirlo; sin él se escribe y se imprime un resumen.
- Una transformación declara de qué versión a qué versión sirve; la orden se niega a correr fuera de ese rango.

## 5. Fases

- **F0. Elegir la herramienta (D2)** con la ruptura de SPEC-0015 como caso real: ¿qué imports cambiaron exactamente? Se extraen del diff de #179.
- **F1. El paquete, la orden `--list` y `--dry-run`,** con la transformación de imports de SPEC-0015 y su par `antes/después`.
- **F2. `bump-ranges`:** el barrido de rangos 0.x que hoy se hace con scripts sueltos, como orden reutilizable (también la usa el procedimiento de release).
- **F3. SPEC-0016 y la migración a zod 4** (esta última con los avisos de D3).
- **F4. Guías en la web** para cada ruptura pasada, y la regla "una ruptura sale con su transformación y su guía" en la lista de cierre de release.

## 6. Criterios de aceptación

- Cada transformación es idempotente y tiene su par `antes/después` en las pruebas.
- Ninguna transformación borra ni reescribe código que no entiende: lo marca.
- Una ruptura futura no se publica sin su guía y, cuando es mecánica, sin su transformación.

## 7. Riesgos y fuera de alcance

- Las rupturas ya publicadas son pocas; el valor crece con las futuras. Por eso F4 fija la regla de proceso, que es lo que dura.
- Fuera de alcance: migrar **datos** (journals, archivos de aprobaciones) entre versiones; si una ruptura cambia un formato de datos, lleva su propio convertidor en su spec.

## 8. F0: inventario de rupturas y elección de herramienta (2026-11-18)

**Qué cambió en cada ruptura publicada** (leído del `CHANGELOG.md`, secciones v0.40.0, v0.41.0, la migración a zod 4 y el renombrado de paquetes)

| Ruptura | Parte mecánica (candidata a transformación) | Parte que exige criterio (se avisa, no se adivina) |
|---|---|---|
| **SPEC-0015** (0.40.0, `agent-core` 0.39, `agent-coding` 0.29) | `Orchestrator`, `QAService`, los tipos de orchestration y los hooks de reflection (`AuditHook`, `HistoricalLoader`, `LessonsMemoGenerator`...) pasan de `agent-core` a `agent-coding/pipeline`; el subpath `agent-core/orchestration` desaparece; `agent-core/reflection` se sustituye por la raíz. | Las opciones `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA` y `onQAReview` de `createBaseEngine` pasan a un hook `codingPipelineHooks({...})`: es reestructurar una llamada, no mover un import. |
| **SPEC-0016** (0.41.0, `agent-core` 0.40, `agent-coding` 0.30) | Una lista cerrada de símbolos (`discoverAgents`, `SkillLoader`, `SkillManager`, `registerBuiltinCommands`, los checkpoints, los workspaces, `runGlobalSeed`, `loadFrameworkConfig`, el trust...) pasa a `agent-coding/cli`. Siguen en core `SlashCommandRegistry`, `SkillRegistry`, `SkillActivator`, `cwdToProjectKey`, `getFrameworkDir`, `getProjectDir` y `atomicWrite`. | Ninguna: es solo mover imports. |
| **Zod 4** | Ninguna segura. | `z.record(x)` a `z.record(z.string(), x)`, `invalid_type_error` a `error`, y los mensajes de error cambian: lo primero es casi mecánico, lo demás no. |
| **Renombrado de paquetes** (`@bk/*`) | `@bk/agent-core`, `@bk/agent-coding`, `@bk/mcp-server` a `@backendkit-labs/*`, en imports y en `package.json`. | Ninguna. |
| **Rangos 0.x** (cada ruptura) | `^0.38` a `^0.39` y los peers `<0.41.0`, en todos los `package.json`. | Ninguna, pero hoy se hace con scripts sueltos. |

**Lo mecánico es sobre todo mover símbolos entre módulos.** Eso fija lo que `ts-morph` tiene que hacer bien: partir un `import` que mueve solo algunos de sus símbolos, sin tocar el resto.

**Prueba de las dos herramientas** (`ts-morph` y `jscodeshift`, sobre un archivo con tres `import` de `agent-core`, uno multilínea con un comentario y un `import * as core`):

| | `ts-morph` | `jscodeshift` |
|---|---|---|
| Mueve `Orchestrator`, `QAService` y `AuditHook` a `agent-coding/pipeline` | Sí, **en un solo import nuevo** (junta lo que mueve) | Sí, pero en **dos imports nuevos**, uno por cada origen |
| Lo que no se mueve | Intacto, con su formato y su comilla | El `import { defineTool }` multilínea pasa a una línea |
| Un comentario dentro del import multilínea | Se queda donde estaba | **Viaja** al import nuevo y deja el import partido en tres líneas sin sangría |
| Peso instalado | 14 MB (con su copia de TypeScript) | 12 MB (con Babel) |
| API | Tipada y legible (`getNamedImports`, `addNamedImports`) | Más baja (nodos del AST) |

**D2 se cierra: `ts-morph`.** Respeta mejor el código ajeno, que es el criterio 6 ("no reescribe lo que no entiende"). El `import` nuevo sale con comilla doble: se ajusta con `manipulationSettings.quoteKind`, y F1 lo cubre con una prueba.

**Un caso que ninguna herramienta resuelve sola** y que D3 ya prevé: `import * as core from '@backendkit-labs/agent-core'` seguido de `core.Orchestrator`. No es un import con nombres: la transformación lo detecta por el uso del namespace y deja `// TODO(codemod)`, no lo reescribe.

**Sin comprobar:** el rendimiento en un proyecto grande, y que la orden se pueda lanzar con `npx` sin traer a quien la use los 14 MB de `ts-morph` dos veces (se resolverá en F1 con el paquete publicado).

## 9. F1: `@backendkit-labs/codemod` (2026-11-18)

`packages/codemod`, con la orden `codemod <transformación> [ruta] [--dry-run]` y `codemod --list`. Tres transformaciones, cada una **datos** (qué símbolos pasan de qué módulo a cuál) sobre un mismo motor:

| Transformación | Qué hace |
|---|---|
| `scope-rename` | `@bk/agent-core`, `@bk/agent-coding`, `@bk/mcp-server` a `@backendkit-labs/*`. |
| `coding-split` (SPEC-0015) | 9 nombres de `agent-core` a `agent-coding/pipeline`; el subpath `agent-core/orchestration` pasa a ser el pipeline; en `agent-core/reflection`, los hooks de auditoría van al pipeline y el resto a la raíz. `ProjectStoreData` y `SessionUpdates` (existían en `agent-core` y ya no existen en ningún sitio) se **marcan**, no se mueven. |
| `terminal-app-split` (SPEC-0016) | Los 66 nombres de descubrimiento de agentes, skills, comandos, checkpoints, workspaces y trust, a `agent-coding/cli`. |

**Las listas no salen del changelog:** son los nombres que `packages/core/src/index.ts` exportaba antes de cada ruptura y ya no exporta después (calculados con el compilador sobre los commits de #179 y #182), y cada uno se comprobó contra lo que exporta hoy el paquete de destino (66 de 66 para `cli`; 9 de 11 para `pipeline`, y los 2 que faltan son los marcados).

**D2 cambia: el compilador de TypeScript, no `ts-morph`.** §8 eligió `ts-morph` por cómo respeta el código ajeno. Al añadirlo como dependencia de producción, el `audit-gate` del CI se pone rojo: arrastra `picomatch` (por `@ts-morph/common`, `tinyglobby` y `fdir`), que tiene un ReDoS de severidad alta **sin versión corregida** (el aviso cubre hasta la 4.0.7, la última). Solo se explotaría con un patrón de glob controlado por un atacante, que aquí no existe, pero abrir una excepción en el gate de seguridad por una comodidad no compensa. El motor usa directamente la API del compilador (`typescript`, sin `picomatch`) y edita **el texto por posiciones**: lo que no es un `import` o un `export ... from` que entienda queda byte por byte igual, con su espaciado, comentarios, comillas y saltos de línea (CRLF incluido). Resultado más fino que con `ts-morph`, que reformateaba. Los mismos pares `antes/después` pasaron con ambos motores.

**Cumple los criterios de §6:** cada transformación es idempotente (se prueba corriéndola dos veces), tiene su par `antes/después`, y lo que no entiende lo marca con `// TODO(codemod): ...` en vez de reescribirlo: un nombre que ya no existe, `import * as core` seguido de `core.Nombre` de algo que se movió, y un `export { Nombre } from` de algo que se movió.

**Desviación de §4:** no se negará a correr fuera de un rango de versiones. Con las transformaciones idempotentes, correrla en un proyecto que ya migró no cambia nada, y detectar la versión instalada añade un modo de fallo (monorepos, `workspace:`, rangos) sin proteger de nada. `--list` dice la versión que pide cada una.

**Pruebas:** 38 (100 % de líneas): los tres pares `antes/después`, idempotencia, `--dry-run`, 13 casos de un solo archivo con la salida exacta (nombre en medio o al final, todos los nombres, `import` por defecto más nombrados, alias y `type`, sin salto de línea final, sin punto y coma, dos declaraciones hacia un mismo import nuevo, unirse a un import existente, import de efectos, `export *`), listas en varias líneas con comentarios, CRLF y comillas, JavaScript, carpetas ignoradas (`node_modules`, `dist`, `*.d.ts`), un archivo suelto como ruta y los errores de la línea de comandos.

**Sin comprobar:** un proyecto grande de verdad (es lo siguiente: `aiops-agent`); la distribución con `npx` del paquete publicado; `require()` y `import()` dinámico (no se tocan, y el README lo dice). El paquete no está publicado.

## 10. Prueba con un proyecto real: `aiops-agent` (2026-11-18)

Un agente de producción de 2 459 líneas en `src/` y 10 suites de pruebas (78 casos), escrito contra `agent-core ^0.27.0`, `agent-coding ^0.23.0` y `agent-enterprise ^0.4.3`, es decir, **de antes de las dos rupturas de §8**. Se trabajó sobre una **copia** (el original no se tocó: `git status` limpio) subiendo sus dependencias a las publicadas hoy (`agent-core 0.45.0`, `agent-coding 0.32.3`, `agent-enterprise 0.11.2`, `mcp-server 0.19.7`, `agent-providers 0.3.12`).

| Paso | Resultado |
|---|---|
| Subir las dependencias, sin tocar el código | `tsc`: **1 error**, `Expected 2-3 arguments, but got 1` en `z.record(z.unknown())`. |
| `coding-split`, `terminal-app-split`, `scope-rename` en `--dry-run` | **0 archivos**: el proyecto no importa ninguno de los nombres que se movieron (usa `defineTool`, `z`, tipos y `OllamaProvider`). Correcto, no un fallo: no hay nada que mover. |
| `zod4-record` (nueva, ver abajo) | **1 archivo, 1 línea**: `z.record(z.unknown())` pasa a `z.record(z.string(), z.unknown())`. `tsc`: **0 errores**. |
| Pruebas del proyecto (`jest`) | **77 de 78.** Las 2 que fallaban de más eran un artefacto mío (la copia no traía el directorio `vault/`). |
| El caso que queda | `guard.test`: `ToolArgumentError ... Too big: expected number to be <=4`. **No es mecánico:** desde 0.34 `defineTool` **lanza** `ToolArgumentError` en vez de devolver el texto (está en el CHANGELOG como "Cambia el comportamiento de quien llame a `execute` de una tool de `defineTool` directamente"), y `runTool` del proyecto llama a `tool.execute` fuera de un engine. Un `try/catch` que devuelve `needs_human`, escrito a mano, lo resuelve: **78 de 78**, `tsc` en 0. |

**Lo que se aprendió**

1. **Saltar 18 versiones (0.27 a 0.45) costó 2 cambios de código:** uno mecánico (ahora lo hace la orden) y uno de comportamiento (hay que saberlo; va a la guía de F4, que lo dice en la primera línea de la sección de `defineTool`). El compilador lo cazó todo salvo el segundo, que solo se vio al ejecutar las pruebas: **una guía de migración sin ejecutar pruebas no basta.**
2. **El inventario de §8 tenía un hueco:** la ruptura de zod 4 sí tiene una parte mecánica clara (`z.record` de un argumento), y §8 la había anotado como "casi nada seguro". Se añadió la transformación **`zod4-record`**: solo actúa en un archivo que importa `z` de `zod` o de `agent-core`, solo sobre ese nombre y con un único argumento; lo que no es mecánico (`invalid_type_error`, `required_error`, cuyos mensajes además cambian) se **marca** con `// TODO(codemod)` y no se reescribe. 15 pruebas nuevas, par `antes/después` incluido; el motor de imports no se tocó.
3. **El proyecto no usa los nombres de las rupturas grandes:** `coding-split` y `terminal-app-split` solo se han probado con fixtures. Falta un proyecto que use `Orchestrator`, `QAService` o `discoverAgents` de verdad. Candidatos dentro de este mismo repositorio: `packages/coding` y los ejemplos de `examples/`.

**Sin comprobar:** `agent-enterprise` y `mcp-server` en uso real más allá de que compilan (las pruebas de `mcp` y de conocimiento pasan); una subida de versión que atraviese una ruptura que el proyecto sí use.

## 11. Contra una migración que ya hizo una persona (2026-11-18)

Una forma de probar un codemod sin inventar un proyecto: la ruptura de SPEC-0016 la migró a mano el commit `854b3a32` en `packages/mcp-server`. Se exportó `mcp-server/src` **antes** (`854b3a32^`) y **después** de ese commit, se aplicó `terminal-app-split` al "antes" y se comparó con el "después".

| | |
|---|---|
| Archivos que cambió la orden | 3, 4 símbolos movidos (`createSkillManager`, `SkillManager`, `InstalledPack`, `SkillLoader`). |
| Líneas de `import` que difieren de lo que escribió la persona | **1**, y no es un movimiento: la persona añadió `detectStack` al import de `SkillLoader`. |
| Casos que la orden resolvió igual que la persona | `import type { Skill, InstalledPack }` partido en dos (`Skill` se queda en `agent-core`, `InstalledPack` va a `cli`); `SkillActivator` se queda y `SkillLoader` se va, del mismo `import`. |

**Lo que la orden no hace, y la persona sí hizo:** en dos sitios de ese commit había `const { SkillActivator } = await import('@backendkit-labs/agent-core')` seguido de `new SkillActivator().detectStack(cwd)`, y quedó `const { detectStack } = await import('@backendkit-labs/agent-coding/cli')` y `detectStack(cwd)`. Son dos cosas fuera del alcance declarado: un `import()` **dinámico** (la orden solo lee `import` y `export ... from` estáticos) y un **método** que pasó a ser una función suelta (no es un export de `agent-core` que desaparezca, así que no sale de la lista de nombres). Va a la guía de migración de F4, que lo dice en su sitio; y queda como límite documentado del README.

**`coding-split` sigue probado solo con fixtures.** En el commit anterior a la ruptura de SPEC-0015 ningún paquete ni ejemplo del repositorio, fuera de `core` y `coding`, importaba esos nombres de `agent-core` (las coincidencias de una búsqueda por la palabra eran nombres de agentes "orchestrator"). Hace falta un proyecto externo que use `Orchestrator`, `QAService` o los hooks de auditoría de `agent-core` para probarlo de verdad.

## 12. F4: la guía y la regla de cierre (2026-11-18)

**La guía:** `site/src/content/docs/guides/migrate-between-versions.md`, una sola página con las rupturas en orden cronológico (scope, `ToolArgumentError`, zod 4, `coding-split`, `terminal-app-split`). Cada sección dice qué cambió, qué hace la orden y qué queda a mano. Abre con el orden que funcionó en §10 (subir rangos, correr las órdenes, `tsc`, **y las pruebas**) y recoge los dos casos reales que la orden no cubre: el cambio de comportamiento de `defineTool` y el `import()` dinámico con `SkillActivator.detectStack`.

**La regla "una ruptura sale con su transformación y su guía":** el repo no tiene un documento de cierre de release donde ponerla (el procedimiento vive en la memoria del mantenedor, no en un archivo versionado), así que queda aquí como criterio de §6 y como la pregunta que se hace al cerrar un release con ruptura: ¿tiene su sección en `migrate-between-versions` y, si es mecánica, su transformación en `packages/codemod`? Pendiente: llevarla a un archivo versionado si se crea uno.

**Sin comprobar:** que los enlaces y fragmentos (`#validation-throws-since-agent-core-034`) resuelvan en el sitio desplegado; el build de Astro pasa.
