# SPEC-0009: Confianza del workspace y límites aplicados

**Fecha:** 2026-10-24
**Estado:** En curso (C1 y C3 implementados y publicados en 0.34; C3b pendiente)
**Depende de:** SPEC-0003 y SPEC-0008 (Hermes), SPEC-0006 (política de sandbox), [ADR-0002](../adr/0002-aborto-automatico-por-presupuesto.md) (presupuesto)
**ADR:** [ADR-0006](../adr/0006-confianza-del-workspace.md) (confianza del workspace), [ADR-0007](../adr/0007-un-limite-declarado-debe-aplicarse.md) (un límite declarado debe aplicarse)
**Origen:** la auditoría de 2026-10-24 (lotes #93–#96) y la opinión posterior del auditor sobre el modelo de capacidades, verificada punto por punto contra el código. Este spec recoge lo que esa opinión acierta y descarta lo que no resultó cierto.
**Objetivo:** que lo que un agente puede hacer lo decida quien lo opera, no el contenido de un repositorio, y que cada límite que el framework acepta sea un límite que aplica.

## 1. Punto de partida (verificado)

**Lo que ya está bien y no se toca:** `AgentProfile` con `allowedTools`, `delegatesTo`, `provider`, `secrets` (referencias `{ env }`) y `blockedCommands`; el sandbox con modo, raíces de ruta, red y herencia verificada (`checkNarrower`); en Hermes, los blueprints con `createRoles`, `covers`, `ttlMinutes`, aprobación y `verifyBuilt`, que lee de vuelta la política del agente construido.

| Hallazgo | Evidencia | Estado |
|---|---|---|
| La capa de proyecto se carga sin control de confianza | `coding/src/index.ts:424` (`AgentLoader.load` con `cwd`), `core/src/skills/loader.ts` (`loadProject(cwd)`) | Confirmado. `TrustConfig` solo gobierna `install(source)`. |
| El proyecto pisa por id a builtin y global | `coding/src/agents/AgentLoader.ts:151-155` | Confirmado. |
| Un repositorio puede redirigir proveedor o claves | `coding/src/config/ConfigLoader.ts:103-105` (solo `~/.{app}/config.json`) | **Descartado:** los proveedores son solo globales. |
| `delegatesTo: ['*']` | `core/src/engine/AgentEngine.ts:854-861`, `coding/src/agents/profiles.ts:47` (`general`) | Confirmado: alcanza todos los agentes registrados, incluidos los de proyecto. |
| Límites del fleet declarados sin aplicar | `hermes/src/fleet/schema.ts:64-70` | Confirmado y documentado en el propio schema. |
| `budgetUsdPerDay` obligatorio y sin efecto en el blueprint | `hermes/src/fleet/provisioning.ts:88-91` | Confirmado. Es la peor forma: obliga a escribir una cifra que no controla nada. |
| `ttlMinutes` y `maxLive` | `hermes/src/provisioning/Provisioning.ts:222-233` | **Aplicados.** |
| `.md` con `model:` pisa el proveedor | `AgentLoader.ts` (`if (fm.model) def.provider = fm.model`, y en `applyPromptOverrides` con el comentario `// model maps to provider`) | **Corregido tras implementar C1:** no es un error de copia. Es un alias deliberado desde el commit que introdujo el frontmatter (`40878755`); lo que ocurre es que `AgentProfile.model` existe hoy y el frontmatter no puede fijarlo. Ver C4. |
| `AgentLoader` calculaba el directorio global con `os.homedir()` | `AgentLoader.ts` (3 sitios) | Confirmado y corregido en C1: el resto del framework usa `getFrameworkDir` (`USERPROFILE ?? HOME ?? homedir()`). Sin esa unificación la confianza y los agentes podían mirar homes distintos. |
| `AGENT.md` del repositorio entra en el prompt | `coding/src/index.ts` (`buildProjectContext`) | Confirmado. Es otra vía de prompt del repositorio; **no se gatea en C1** (ver §4). |
| No existe un tipo de agente | búsqueda de `kind` / `AgentType` en `packages/*/src` | Confirmado. `source` es procedencia, no tipo. Se deja así. |
| Rate limit por agente | no encontrado | Sin verificar que exista. |

## 2. Fases

### C1 — Confianza del workspace (core, coding) · ADR-0006
- Módulo único de confianza (en `core`, usado por `coding`): `isProjectTrusted(appName, projectPath)`, `trustProject(...)`, `untrustProject(...)`. Lee y escribe `~/.{appName}/trusted-projects.json`; la clave es la ruta real normalizada (`realpath`, separadores y mayúsculas según el sistema). `BK_TRUST_PROJECT=1` confía cualquier ruta.
- `AgentLoader.load` y `SkillLoader.loadAll`/`loadProject` reciben el resultado de esa comprobación. No confiado: no cargan la capa de proyecto y devuelven la lista de lo omitido.
- `createCodingEngine` emite un evento `system` de nivel `warn` con lo omitido y cómo confiar. Un comando de barra (`/trust`) y una función exportada permiten confiar.
- La precedencia y los overrides `.md` se mantienen intactos para proyectos confiados.

**Tests:** proyecto sin confiar → solo builtin y global, con aviso; confiado → se cargan y el override `.md` funciona; la ruta se normaliza (`..`, enlaces simbólicos, mayúsculas en Windows); `BK_TRUST_PROJECT=1`; un archivo de confianza corrupto cuenta como "nadie confiado", no como "todos"; ni un agente ni una skill pueden escribir en la lista de confianza.

**Salida:** abrir un repositorio con `.bk-agent/agents/general.json` y `.bk-agent/skills/x.md` no los carga hasta confiar la ruta, y el aviso lo dice.

**Implementado (2026-10-24, publicado en 0.34):**
- `core`: `trust/workspace-trust.ts` (`isProjectTrusted`, `trustProject`, `untrustProject`, `listTrustedProjects`, `projectLayerContents`, `untrustedLayerWarning`), exportado desde el índice; `SkillLoader.loadProject(cwd, trusted?)` y `loadAll(cwd, projectDir, trusted?)`; comando `/trust` (`status`, `add`, `remove`, `list`) y `CommandContext.workingDir` (que `getCommandBindings()` rellena).
- `coding`: `AgentLoader.load({ trusted })` (no lee la capa de proyecto, no aplica sus overrides `.md` y **no crea directorios dentro del proyecto** si no está confiado), `createCodingEngine({ trustedProject })` decide una vez, lo pasa a agentes y skills y emite el aviso `[Trust]` con lo omitido.
- Decisiones de implementación: coincidencia por **ruta exacta** (confiar en un directorio no confía en sus hijos); un archivo ausente, ilegible o dañino significa **nadie** confiado; la lectura nunca escribe; `/trust add` recarga las skills al momento y los agentes al siguiente arranque.
- Límite conocido: el archivo de confianza está en el directorio del usuario y un agente con `run_command` podría escribirlo (`echo ... > ~/.bk-agent/trusted-projects.json` pasa la allowlist, que no vigila el destino de las redirecciones). Lo acota la aprobación de `run_command`, y solo surte efecto en el siguiente arranque.

### C2 — `delegatesTo: ['*']` explícito · ADR-0006
- `'*'` resuelve sobre los agentes realmente cargados. Con C1, un agente de proyecto no confiado no existe, así que deja de ser alcanzable.
- Decisión abierta (§4): si el builtin `general` debe listar sus especialistas por nombre en lugar de usar el comodín. Preferible por mínimo privilegio, pero cambia el comportamiento de quien añade especialistas propios y espera que `general` los vea.

**Tests:** con un agente de proyecto sin confiar, `general` no lo ve; confiado, sí.

### C3 — Límites aplicados (hermes, core) · ADR-0007
**Implementado (2026-10-24, publicado en 0.34):**
- `maxConcurrent`: semáforo por agente en `Hermes.run`. **Se rechaza con `AGENT_BUSY`, no se encola** (este spec decía "esperan hasta `deadlineMs`"; `deadlineMs` acota la espera del resultado, no la admisión; ver ADR-0007 §2). Cuenta runs de capabilities, no flows; se comprueba antes de pedir aprobación y se reclama después; comprobar y reclamar es un paso síncrono; un run recuperado tras un reinicio ocupa hueco; el hueco se libera antes de escribir el estado final.
- Presupuesto del blueprint: deja de ser obligatorio. `creator.budgetUsdPerDay` sigue acotando lo que se declare.
- `fleetWarnings(fleet)` (exportado) y `bk-hermes validate`, que imprime `warning:` en stderr y sigue saliendo con 0: `agents[].limits.budgetUsdPerDay`, `blueprints[].limits.budgetUsdPerDay` (y el techo del creador si el blueprint no declara ninguno) y **`policies.budget.perRunUsd` / `perDayUsd`**, un tercer campo declarado y no aplicado que este spec no había listado. El registro de auditoría de una creación anota el presupuesto declarado. Los `fleet.yaml` existentes no se rechazan.

**Tests:** el semáforo limita la concurrencia real (8 llamadas simultáneas, 2 arrancan), libera al fallar y al cancelar, no retiene el hueco durante una aprobación y lo vuelve a comprobar después, es por agente, y un run recuperado tras reiniciar lo ocupa; `validate` emite el aviso exacto y no falla; un blueprint sin presupuesto es válido y uno por encima del techo no.

### C3b — Presupuesto aplicado (hermes, agent-protocol) · pendiente · ADR-0007 §5
**Corrección:** este spec decía que Hermes construiría el engine de un agente en proceso con `observability.budget` y `abortOnBudget`. No es viable: `InProcessConnector` recibe funciones (`handler`), no un engine, y una instancia aprovisionada la construye el provisionador del anfitrión a partir de un `template` que Hermes no interpreta. Hermes no ve el gasto.
- **Diseño necesario:** un canal de coste. `RunOutcome.costUsd?` opcional que el conector informa (un handler en proceso lo devuelve; `agent-protocol` lo transporta en el resultado de la tarea), un acumulado diario por agente (día UTC) en el store de runs, y rechazo de nuevas ejecuciones con un código claro (`BUDGET_EXCEEDED`) al alcanzar `budgetUsdPerDay`.
- **Cambia contratos** (`connectors/types`, `agent-protocol`) y exige que cada agente informe de su coste; un agente que no lo informe sigue siendo declarativo y se avisa.
- **Preguntas abiertas:** ¿el acumulado se persiste (sobrevive reinicios) o es de proceso?; ¿qué hace una ejecución en curso al alcanzarse el límite: termina o se cancela?; ¿`policies.budget.perRunUsd` se aplica aquí o es del engine?

**Salida de C3 (parcial):** ningún campo de límite del schema de Hermes queda sin enforcement *o sin aviso*; los presupuestos siguen siendo solo declarativos hasta C3b. La regla de revisión de ADR-0007 en la plantilla de PR sigue pendiente.

### C4 — Alias `model` → `provider` en el frontmatter (coding)
**Corregido:** esta fase decía "error de copia". No lo es. `model:` en el frontmatter de un `.md` se asigna a `provider` a propósito (`// model maps to provider`, desde el commit del parser, `40878755`), cuando el campo `model` aún no existía en el perfil.
- **El problema real:** `AgentProfile.model` (override de modelo por agente) existe hoy y el frontmatter no puede fijarlo; quien escribe `model: deepseek-chat` espera el modelo y recibe un cambio de proveedor.
- **Opciones:** (a) añadir `model` al frontmatter y conservar el alias solo cuando el valor coincide con un id de proveedor configurado; (b) deprecar el alias con un aviso y migrar a `provider:` / `model:` separados. Cualquiera cambia el comportamiento de quien depende del alias, así que no es un arreglo de una línea.
- **Decisión pendiente**; no se toca en C1.

### C5 — Tipo `Capability` único (diseño, sin código)
La propuesta del auditor: un tipo `Capability { tools, roots, budget?, rate? }` que compartan `AgentProfile` y `Blueprint`.
- **Qué tiene de cierto:** hoy `allowedTools` es una lista plana, las raíces de ruta viven en la política del sandbox (por engine, no por perfil), y el presupuesto vive en la observabilidad (por engine). El `Blueprint` de Hermes ya agrega herramientas, política de sandbox, límites y acceso, y `checkNarrower` lo valida contra el creador. Lo que falta es que `AgentProfile` comparta ese modelo.
- **Prerrequisito:** C3. Un `Capability` con `budget` y `rate` sin enforcement repetiría el problema de ADR-0007. No hay evidencia de que exista un limitador de tasa por agente; habría que construirlo o no exponer `rate`.
- **Pendiente de decidir:** si la unificación es un tipo nuevo o la extensión de `Blueprint` hacia `AgentProfile`; cómo se estrecha una `Capability` hija respecto de la madre (generalizar `checkNarrower`); compatibilidad con perfiles existentes.
- **Diferido:** unificar `create-bk-agent` con el blueprint. Hoy `template` es una cadena opaca ("which kind of agent the host's provisioner builds"), acoplada lo justo.
- **Fuera de alcance:** formalizar un "tipo de agente" (`coding` / `domain-agent` / ...). Sin invariantes por tipo que hacer cumplir, es burocracia.

## 3. Orden y PRs
`C1` → `C2` (depende de C1) → `C4` (independiente, cabe en cualquier PR) → `C3` → `C5` (solo diseño; se convierte en spec propio si se decide).
`C1` es un PR de `core` + `coding` con CHANGELOG de cambio de comportamiento; `C3` toca solo `hermes` (y `core` si hace falta exponer la atribución).

## 4. Preguntas abiertas
1. **¿Qué cuenta como proyecto?** `workingDir ?? process.cwd()` en un CLI es lo que el usuario abrió; en un servicio es una ruta fija de despliegue. ¿Un servicio confía su propio directorio por defecto?
2. **¿Confianza por ruta o por origen git / hash?** El ADR-0006 empieza por ruta y deja la puerta abierta a las otras.
3. **¿`general` lista sus especialistas?** (C2).
4. **¿Rechazar, algún día, los límites no aplicados?** ADR-0007 empieza por avisar.
5. **¿Los presets y blueprints de Hermes son "capa de proyecto"?** No: los fija el operador. Se deja fuera de la puerta; confirmar.
6. **¿`AGENT.md` entra en la puerta?** El repositorio lo aporta y `buildProjectContext` lo mete en el prompt: es la misma clase de riesgo (prompt controlado por el repo), pero es su función documentada (instrucciones del proyecto, como un `CLAUDE.md`). Gatearlo rompe el uso principal en repos no confiados; no gatearlo deja una vía abierta. Pendiente de decidir, quizá con un aviso que lo indique en lugar de bloquearlo.
7. **Dónde se confía en un servicio:** `createCodingEngine({ trustedProject })` y `BK_TRUST_PROJECT=1` cubren a un host que decide por sí mismo; falta decidir si un servicio debe confiar su propio directorio por defecto (pregunta 1).

## 5. Fuera de este spec
Pendientes de la misma auditoría, que son decisiones de diseño aparte: autenticación del HTTP de `mcp-server` (el header `Authorization` ya es el JWT de ABAC), la allowlist de `run_command` y docker como default, `AgentServer` escuchando en `0.0.0.0` por defecto, `WebhookServer` con `secret` opcional.
