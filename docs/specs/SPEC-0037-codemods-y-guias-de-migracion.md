# SPEC-0037: codemods y guías de migración

**Fecha:** 2026-11-17
**Estado:** Borrador. **F0 hecha (2026-11-18)**: inventario de las rupturas reales, ver §8. **F1 hecha (2026-11-18)**: el paquete, `--list`, `--dry-run` y tres transformaciones (`scope-rename`, `coding-split`, `terminal-app-split`), ver §9; la herramienta final es el compilador de TypeScript, no `ts-morph`. F2, la parte de zod 4 de F3 y F4 sin hacer.
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
