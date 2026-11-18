# SPEC-0037: codemods y guías de migración

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D5 con propuesta; sin implementar.
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
