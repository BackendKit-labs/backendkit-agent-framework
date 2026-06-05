# create-bk-agent — Plan de implementación

> Seguimiento de las dos iniciativas acordadas: rediseño del flow de preguntas y sistema de módulos `add`.

---

## Estado general

| Iniciativa | Estado | Prioridad |
|---|---|---|
| A — Rediseño de prompts (arquitectura × deploy) | ✅ completo | 1 |
| B — Comando `add <module>` (sistema de módulos) | ⬜ pendiente | 2 |

---

## Iniciativa A — Rediseño del flow de preguntas

**Problema:** La pregunta "Template" actual mezcla arquitectura con modo de deploy en un solo selector sin suficiente descripción. El usuario no puede distinguir si `mcp-server` es una arquitectura o un modo de exposición.

**Solución:** Reemplazar 1 pregunta por 3 encadenadas: arquitectura → skills → deploy.

### A.1 — Nueva estructura de tipos en `prompts.ts` ✅

- [x] Reemplazar `TemplateId` por `ArchitectureId`
- [x] Agregar `SkillPack`
- [x] Agregar `DeployMode`
- [x] Actualizar `UserChoices`
- [x] `scaffold.ts`: `resolveTemplateDir(architecture, deployMode)` mapea a legacy dirs (bridge hasta A.4)
- [x] `index.ts`: `NEXT_STEPS` keyed por `ArchitectureId`
- [x] `tsc --noEmit` sin errores

### A.2 — Flow de preguntas encadenado en `prompts.ts` ✅

- [x] **Pregunta 1 — Arquitectura** (siempre): 5 opciones con description hint
- [x] **Pregunta 2 — Skills** (solo `multi-agent` | `single`): multiselect, 4 packs
- [x] **Pregunta 3 — Deploy** (solo `multi-agent` | `single` | `coding`): 5 modos
- [x] **Pregunta 4 — Provider** (siempre): sin cambios
- [x] `scaffold.ts`: `resolveTemplateDir` cubre todas las combinaciones nuevas
- [x] `tsc --noEmit` sin errores

### A.3 — Reestructurar templates en `templates/` ✅

- [x] `base/multi-agent/` — de `domain-agent/` sin index.ts; `createDomainEngine` → `createEngine`
- [x] `base/single/` — nuevo: un agente directo, sin orchestrator, exporta `createEngine`
- [x] `base/coding/` — copia de `coding/` (self-contained)
- [x] `base/autonomous/` — copia de `autonomous/` (self-contained)
- [x] `base/minimal/` — copia de `minimal/` (self-contained)
- [x] `deploy/repl/src/index.ts` — importa `createEngine` de `./engine`
- [x] `deploy/mcp-http/src/server.ts` — `AgentMCPServer.start()` (HTTP)
- [x] `deploy/mcp-stdio/src/server.ts` — `AgentMCPServer.startStdio()` (stdio)
- [x] `deploy/hybrid/` — index.ts (REPL) + server.ts (HTTP) combinados
- [x] `library` sin archivos (solo base, sin deploy layer)
- [x] `tsc --noEmit` sin errores
- Nota: los templates legacy (`domain-agent/`, `mcp-server/`) se eliminan en A.4

### A.4 — Actualizar `scaffold.ts` para composición por capas ✅

- [x] `copyDir(base/<arch>, target)` → `copyDir(deploy/<mode>, target)` overlay
- [x] Solo `multi-agent` y `single` usan deploy layer; el resto es self-contained
- [x] `patchPackageJson` ajusta scripts según `deployMode` (tabla `DEPLOY_SCRIPTS`)
- [x] `injectSkillPack`: append comment block en `engine.ts` con hint de configuración
- [x] `writeEnv`: agrega `LLM_BASE_URL` para providers OpenAI-compatible
- [x] Bridge legacy (`resolveTemplateDir`, `LegacyDir`) eliminado
- [x] `tsc --noEmit` sin errores

### A.5 — Actualizar `index.ts` ✅

- [x] `NEXT_STEPS` estático → `buildNextSteps(choices)` que cubre todas las combinaciones
- [x] Banner "Creating X — Y agent" refleja arquitectura + deploy mode
- [x] `describeChoices()` produce etiquetas legibles por humanos

### A.6 — Tests de regresión ✅

Script: `scripts/test-scaffold.mjs` — 73 checks, 0 fallos.

- [x] `multi-agent × repl` — 14 checks: engine, orchestrator, specialists, index, .env, scripts
- [x] `coding` — 7 checks: self-contained, createCodingEngine, AGENT.md
- [x] `autonomous` — 4 checks: self-contained, createAutonomousAgent
- [x] `minimal` — 3 checks: self-contained
- [x] `single × mcp-http` — 11 checks: engine, my-agent, server.ts, AgentMCPServer, scripts
- [x] `multi-agent × hybrid` — 9 checks: index + server coexisten, scripts dev + server
- [x] `multi-agent × mcp-stdio` — 5 checks: server.startStdio(), no index.ts
- [x] `single × repl + skills` — 4 checks: skill hints inyectados en engine.ts
- [x] `multi-agent × library` — 6 checks: solo engine, sin scripts de ejecución

---

## Iniciativa B — Comando `add <module>` (sistema de módulos)

**Problema:** Una vez creado un proyecto con `npx create-bk-agent`, no hay forma de agregar capacidades (server MCP, especialistas, tools) sin editar manualmente el código.

**Solución:** `npx create-bk-agent add <module>` detecta el proyecto, genera archivos y parchea los existentes.

**Caso de uso primario:** `cd git-agent && npx create-bk-agent add server`

### B.1 — Detector de proyecto en `src/add/detector.ts` ✅

- [x] Leer `package.json` del `cwd` y verificar `@backendkit-labs/agent-core` en dependencies
- [x] Leer `src/engine.ts` para detectar arquitectura (¿tiene `ORCHESTRATOR_PROFILE`? → `multi-agent`, sino `single`)
- [x] Exponer `BkProjectInfo` con `cwd`, `architecture`, `engineFile`, `indexFile`, `serverFile`, `pkgFile`, `engineFnName`
- [x] `function detectProject(cwd: string): BkProjectInfo | null`

### B.2 — File patcher en `src/add/patcher.ts` ✅

- [x] `addImportLine` — agrega import al bloque de imports si no existe
- [x] `insertAfterPattern` — inserta línea después de la última ocurrencia
- [x] `insertBeforePattern` — inserta línea antes de la primera ocurrencia
- [x] `addPackageScript` — agrega o reemplaza script en package.json
- [x] `addPackageDependency` — agrega dependencia a package.json
- [x] `addMcpServerEntry` — agrega entrada a mcpServers (array existente o nuevo)

### B.3 — Módulo `server` en `src/add/modules/server.ts` ✅

- [x] Generar `src/server.ts` con import de `AgentMCPServer`, `CallbackTransport`, `z`, y `engineFnName` detectado
- [x] Parchear `package.json`: dep `@backendkit-labs/mcp-server` + script `"server"`
- [x] Guard: error si `server.ts` ya existe; idempotencia

### B.4 — Módulo `specialist` en `src/add/modules/specialist.ts` ✅

- [x] Generar `src/agents/<name>.ts` con `AgentProfile` básico
- [x] Parchear `engine.ts`: import + `agents.register(<NAME>_PROFILE)`
- [x] Guard: error si el archivo ya existe; idempotencia de patches

### B.5 — Módulo `tools` en `src/add/modules/tools.ts` ✅

- [x] Generar `src/tools/<domain>-tools.ts` con dos tool stubs (action + query)
- [x] Kebab-case → camelCase para nombres de export
- [x] Parchear `engine.ts`: import + `tools.register(...)`

### B.6 — Módulo `mcp-client` en `src/add/modules/mcp-client.ts` ✅

- [x] Parchear `engine.ts`: agregar entrada a `mcpServers: [...]` (crea array si no existe)
- [x] Idempotente: no agrega URL duplicada

### B.7 — Orquestador del comando `add` en `src/add/index.ts` ✅

- [x] Parsear `argv`: `add <module> [args...]`
- [x] `detectProject(cwd)`, error si no es proyecto bk-agent
- [x] Dispatch: `server`, `specialist`, `tools`, `mcp-client`
- [x] `add --help` lista módulos con ejemplos

### B.8 — Integrar en `src/index.ts` ✅

- [x] Detectar `argv[2] === 'add'` → `runAdd(argv.slice(3), process.cwd())`
- [x] Sin cambios al flow de creación existente

### B.9 — Tests automatizados en `scripts/test-add.mjs` ✅

Script: `scripts/test-add.mjs` — 27 checks, 0 fallos.

- [x] Suite 1: `detectProject` (6 checks): detección correcta, arquitectura, engineFnName, null para non-project
- [x] Suite 2: `add server` (8 checks): server.ts generado, engineFnName, port/name, deps, script, idempotencia
- [x] Suite 3: `add specialist` (5 checks): archivo generado, const name, engine patched, idempotencia
- [x] Suite 4: `add tools` (6 checks): archivo generado, action+query, engine patched, kebab→camelCase
- [x] Suite 5: `add mcp-client` (5 checks): mcpServers inyectado, idempotencia URL, append second server

---

## Orden de implementación recomendado

```
A.1 → A.2 → A.3 → A.4 → A.5 → A.6   (Iniciativa A — primero, base para B)
B.1 → B.2 → B.7 → B.8 → B.3 → B.4 → B.5 → B.6 → B.9   (Iniciativa B)
```

La Iniciativa A va primero porque reestructura los templates que B.3 necesita como referencia para el template de `server.ts`.

---

## Archivos a crear / modificar

### Iniciativa A

| Archivo | Acción |
|---|---|
| `src/prompts.ts` | Reemplazar |
| `src/scaffold.ts` | Modificar (lógica composicional) |
| `src/index.ts` | Modificar (NEXT_STEPS) |
| `templates/base/multi-agent/` | Crear (mover de `domain-agent/`) |
| `templates/base/single/` | Crear (nuevo) |
| `templates/base/coding/` | Crear (mover de `coding/`) |
| `templates/base/autonomous/` | Crear (mover de `autonomous/`) |
| `templates/base/minimal/` | Crear (mover de `minimal/`) |
| `templates/deploy/repl/` | Crear (extraído de templates actuales) |
| `templates/deploy/mcp-http/` | Crear (extraído de `mcp-server/`) |
| `templates/deploy/mcp-stdio/` | Crear (nuevo) |
| `templates/deploy/hybrid/` | Crear (nuevo) |
| `templates/skills/*.ts` | Crear (snippets de inyección) |

### Iniciativa B

| Archivo | Acción |
|---|---|
| `src/add/detector.ts` | Crear |
| `src/add/patcher.ts` | Crear |
| `src/add/modules/server.ts` | Crear |
| `src/add/modules/specialist.ts` | Crear |
| `src/add/modules/tools.ts` | Crear |
| `src/add/modules/mcp-client.ts` | Crear |
| `src/add/index.ts` | Crear |
| `src/index.ts` | Modificar (detectar `add`) |

---

## Decisiones de diseño fijadas

- **Sin AST/schematics:** regex-based patching alcanza porque los archivos generados son predecibles y pequeños.
- **`autonomous` y `minimal` cortan en pregunta 1:** no necesitan pregunta de deploy ni de skills.
- **`library` como DeployMode:** genera solo `engine.ts` sin entry point — no es una arquitectura distinta.
- **Skills como snippets inyectados en engine.ts**, no como carpetas separadas — simplifica el scaffolding.
- **Retrocompatibilidad:** los templates actuales (`domain-agent`, `mcp-server`) se mapean exactamente a `multi-agent × repl` y `single × mcp-http` respectivamente.
