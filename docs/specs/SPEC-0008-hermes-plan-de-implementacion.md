# SPEC-0008: Hermes — plan de implementación (H0 → H1c)

**Fecha:** 2026-10-23
**Estado:** Borrador
**Depende de:** SPEC-0003 (qué es Hermes), SPEC-0006 (sandbox: política como datos, `authorizePath`, `isNarrowerOrEqual`), SPEC-0007 Parte A (`agent-testkit`)
**Objetivo:** convertir SPEC-0003 en una secuencia de PRs pequeños, cada uno publicable por sí solo y verificable sin API key.

## 1. Punto de partida (verificado)
- **Hecho:** señal de cancelación y plazo por herramienta, jobs en segundo plano, credenciales por referencia (SPEC-0002); sandbox con política JSON que se fija y consulta en caliente (`set`/`snapshot`/`version`), decisiones observables y auditadas, `authorizePath` con symlinks resueltos (SPEC-0006 S1, S3a); `agent-testkit` (proveedor guionado, servidor LLM simulado, `world`).
- **`agent-protocol`** es pequeño (`AgentServer` 218 líneas, `AgentClient` 238) y **no conoce el engine**: expone `health`, `info`, `run`, `tasks/:id` (GET, DELETE). Su `cancel` solo marca la tarea.
- **Falta:** el canal de control (política, jobs, auditoría), el paquete `hermes`, `isNarrowerOrEqual` (PR #79), y todo lo de aprovisionamiento, flows y plugins.

## 2. Decisiones tomadas (2026-10-23)
1. **Dónde corre un agente creado:** en el mismo proceso de Hermes (`InProcessConnector`) en H1b; proceso aparte con `agent-protocol` en H4.
2. **Autonomía por defecto ante una carencia:** `avisar`. Subir a "crear desde blueprint" o "proponer blueprint" es una decisión explícita de cada empresa.
3. **Los blueprints los define el operador.** Hermes puede proponer borradores; no valen hasta que un operador los aprueba.
4. **El control hacia un agente solo estrecha sin aprobación.** `set_sandbox_policy` hacia un modo más amplio exige aprobación (se comprueba con `isNarrowerOrEqual(actual, pedida)`).

## 3. Secuencia de PRs

| PR | Paquete(s) | Contenido | Aceptación (sin API key) |
|---|---|---|---|
| **P1 — Superficie de control** | `agent-protocol` | `ControlHandler` opcional en `AgentServer`: `POST /v1/agent/control` (`pause`, `resume`, `drain`, `set_budget`, `get_sandbox_policy`, `set_sandbox_policy`, `list_jobs`, `cancel_job`), `GET /v1/agent/runs`, `GET /v1/agent/audit`; `info` con `limits`, `version`, `protocolMinor` y flows; códigos de error nuevos (`POLICY_WIDER_THAN_PARENT`, `CONTROL_UNSUPPORTED`). `AgentClient` con `control()`, `listRuns()`, `audit()`. Un servidor sin handler responde `CONTROL_UNSUPPORTED`: es compatible hacia atrás | Un servidor sin handler sigue pasando sus tests; con handler de prueba cada acción responde y valida su entrada; auth y roles se aplican también a `control` |
| **P2 — Enlace con el engine** | `agent-core` (o `agent-web`, ver §5) | `createEngineControl(engine)`: un `ControlHandler` hecho con lo que el engine ya tiene (`engine.sandbox` para política, el `JobRegistry`, `abort`, el log de auditoría). `set_sandbox_policy` aplica `isNarrowerOrEqual` y exige aprobación para ampliar; todo cambio de política queda auditado con quién lo pidió y la `version` resultante. `AgentServer.cancel` conecta con `engine.abort()` | Con `agent-testkit`: fijar `read-only` desde fuera hace que la siguiente escritura del agente se deniegue y quede una decisión auditada; cancelar un job desde fuera lo termina; ampliar sin aprobación falla cerrado |
| **P3 — Esqueleto de Hermes (H0)** | `hermes` (nuevo) | `fleet.yaml` validado con Zod (`bk-hermes validate`), `FleetRegistry`, contrato `AgentConnector`, `InProcessConnector` y `ProtocolConnector`, `RunStore` JSON con reconciliación, herramientas `fleet_list`/`fleet_info`/`agent_run`/`agent_status`/`agent_result`/`agent_cancel`/`fleet_health`, roles y aprobación, guardrails sobre resultados remotos, auditoría | Los criterios de H0 de SPEC-0003 §8 con 2 agentes de prueba (testkit): listar, correr uno corto y uno largo, cancelar, caída detectada, reinicio sin perder runs, rol sin permiso → `FORBIDDEN` |
| **P4 — Control desde Hermes (H1)** | `hermes` | `ProtocolConnector` usa la superficie de P1: herramientas `policy_get`/`policy_set`, `job_list`/`job_cancel`, auditoría unificada (recoge `GET /audit` de cada agente), presupuesto diario persistente, `traceparent` | `policy_set` sobre un agente real cambia su comportamiento en la llamada siguiente y deja una decisión auditada con la versión de política; la vista de auditoría junta las decisiones de dos agentes |
| **P5 — Aprovisionamiento y flows (H1b)** | `hermes` | blueprints en `fleet.yaml`, `agent_create`/`agent_retire` (herencia con `checkNarrower`, `POLICY_WIDER_THAN_PARENT`, falla cerrado sin aprobador, `ttl`, límites de número y profundidad), `FlowConnector`, `fleet.gap` y borradores de blueprint pendientes, `createHermes` | Los criterios de H1b de SPEC-0003 §8 |
| **P6 — Plugins y presets (H1c)** | `hermes` | `HermesPlugin` y su API, carga desde `fleet.yaml`, `requires`, aislamiento de fallos, formato de **preset** (fleet + blueprints + flows + plugins de partida) **independiente del dominio**, y un preset de referencia neutral (`pipeline`: ingesta → proceso → revisión → entrega) | Los criterios de H1c de SPEC-0003 §8: el mismo mecanismo carga presets de dos dominios distintos sin cambiar una línea del núcleo |

**Estado de P3 (2026-10-23).** Implementado en `packages/hermes` con el alcance de la fila de P3: `fleet.yaml` (Zod, `bk-hermes validate`), `FleetRegistry` con salud periódica, `InProcessConnector` y `ProtocolConnector`, `RunStore` JSON con reconciliación por `GET /tasks/:id` (protocolo 1.0), las siete herramientas, roles, aprobación (falla cerrado sin aprobador; `ask` y `always` se comportan igual por ahora), guardrails sobre resultados y auditoría NDJSON. Quedan fuera: `McpConnector`, OTel, chat en `agent-web`, `fleet_budget`, `maxConcurrent` y presupuesto (el esquema los acepta), y que `AgentServer` aborte el handler al cancelar (hoy solo marca la tarea).

Cada PR lleva su propio bump y publicación. P1 y P2 son útiles sin Hermes: cualquier servicio de agentes del framework gana control remoto.

**Principio de P6: el núcleo no conoce ningún dominio.** Plugins y presets son datos y código que se cargan; Hermes no tiene un solo nombre de agente, herramienta o flow de un dominio concreto. Contabilidad, soporte, devops, RR. HH. son *presets* de usuario o de terceros que se distribuyen aparte (`hermes-preset-*`); en el repo solo viven el preset neutral de referencia y los de prueba. Si algo de un dominio hace falta en el núcleo, es una señal de que falta un punto de extensión.

## 4. Orden y dependencias
`#79 (isNarrowerOrEqual)` → P1 → P2 → P3 → P4 → P5 → P6. P3 puede empezar en paralelo a P2 (solo usa el contrato de P1 con un handler simulado), pero P4 necesita P2 y P3.

## 5. Preguntas abiertas
1. **¿Dónde vive `createEngineControl`?** *(Decidido en P2: `agent-core`, sin dependencia de `agent-protocol`; el puerto de política lo pone `agent-sandbox` con `sandboxPolicyControl`; los errores se reconocen por nombre.)* `agent-core` no debería depender de `agent-protocol` (hoy no lo hace). Opciones: (a) en `agent-core` como `ControlHandler`-agnóstico (una interfaz propia y `agent-protocol` la adapta); (b) en `agent-web`, que ya une engine y servidor. Propuesta: (a), con la interfaz definida en `agent-core` y el adaptador de rutas en `agent-protocol`.
2. **¿La política de un agente la fija Hermes, o la dueña es el agente?** *(Decidido en P2: el techo del operador es un límite duro; por debajo, estrechar es libre y ampliar pide aprobación.)* Propuesta: el agente tiene un *techo* configurado por su operador; Hermes puede moverla libremente por debajo del techo y necesita aprobación para tocarlo.
3. **Autenticación del canal de control:** una `apiKey` con rol `control` distinta de la de `run`. mTLS o tokens firmados quedan para H4.

## 6. Riesgos
- **El canal de control es una superficie nueva de ataque:** quien lo alcanza puede ampliar permisos. Por eso `control` exige un rol propio, toda ampliación pasa por aprobación y cada cambio queda auditado con su autor y la versión de política.
- **Estado repartido:** la política vive en el agente y Hermes guarda su copia; manda el agente (se compara por `version` al reconectar).
- **Alcance de P1:** mantenerlo en la superficie HTTP y el contrato; nada de lógica de Hermes dentro de `agent-protocol`.
