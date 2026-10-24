# SPEC-0009: Confianza del workspace y límites aplicados

**Fecha:** 2026-10-24
**Estado:** Borrador
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
| `.md` con `model:` pisa el proveedor | `AgentLoader.ts:105` (`if (fm.model) def.provider = fm.model`) | Error de copia: asigna el modelo al campo `provider`. |
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

### C2 — `delegatesTo: ['*']` explícito · ADR-0006
- `'*'` resuelve sobre los agentes realmente cargados. Con C1, un agente de proyecto no confiado no existe, así que deja de ser alcanzable.
- Decisión abierta (§4): si el builtin `general` debe listar sus especialistas por nombre en lugar de usar el comodín. Preferible por mínimo privilegio, pero cambia el comportamiento de quien añade especialistas propios y espera que `general` los vea.

**Tests:** con un agente de proyecto sin confiar, `general` no lo ve; confiado, sí.

### C3 — Límites aplicados (hermes, core) · ADR-0007
- `maxConcurrent`: semáforo por agente en la flota; las llamadas que exceden esperan hasta `deadlineMs` o fallan con un código claro.
- Presupuesto del blueprint: deja de ser obligatorio. `creator.budgetUsdPerDay` sigue acotando lo que se declare.
- `bk-hermes validate` avisa de cada límite declarado sin enforcement; el registro de auditoría de una creación lo anota. Los `fleet.yaml` existentes no se rechazan.
- Presupuesto aplicado para agentes en proceso: Hermes construye el engine con `observability.budget` y `abortOnBudget` a partir del límite. Hace falta resolver la atribución por agente de la flota (hoy `CostTracker` es por engine). Para agentes `protocol` el campo sigue siendo declarativo.

**Tests:** el semáforo limita la concurrencia real y libera al fallar; `validate` emite el aviso exacto y no falla; un blueprint sin presupuesto es válido; con enforcement, un agente en proceso que supera su presupuesto se aborta.

**Salida:** ningún campo de límite del schema de Hermes queda sin enforcement o sin aviso; la regla de revisión de ADR-0007 está en la plantilla de PR.

### C4 — Error de copia en `AgentLoader` (coding)
- `if (fm.model) def.provider = fm.model` debe asignar a `def.model`. Una línea y un test. Comprobar antes si algún usuario depende, por accidente, de ese comportamiento: pasar `model:` en el frontmatter hoy cambia el proveedor.

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

## 5. Fuera de este spec
Pendientes de la misma auditoría, que son decisiones de diseño aparte: autenticación del HTTP de `mcp-server` (el header `Authorization` ya es el JWT de ABAC), la allowlist de `run_command` y docker como default, `AgentServer` escuchando en `0.0.0.0` por defecto, `WebhookServer` con `secret` opcional.
