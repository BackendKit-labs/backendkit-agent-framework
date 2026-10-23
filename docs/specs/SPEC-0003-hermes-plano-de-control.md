# SPEC-0003: Hermes — plano de control de agentes

**Fecha:** 2026-10-22
**Estado:** Borrador
**Plan de implementación:** SPEC-0008.
**Depende de:** SPEC-0002 (cancelación, jobs, credenciales por referencia); fases posteriores de SPEC-0004, SPEC-0005 y SPEC-0006
**Contexto:** `docs/notes/analisis-deepseek-harness-y-hermes.md`

## 1. Qué es y qué no es

**Hermes** es un agente supervisor construido con el propio framework (`createBaseEngine`) que registra, descubre, ejecuta, vigila y controla a los demás agentes: los creados con el framework y, más adelante, agentes externos (Claude Code, Codex, cualquier agente ACP).

**Hermes por empresa.** La idea de producto es crear *Hermes específicos* según lo que necesite cada empresa: uno controla los **flujos** de otros agentes, los supervisa y **genera agentes nuevos cuando hace falta**. Por eso el control sobre agentes y automatizaciones (políticas, flujos, creación con límites) es tan central como delegar trabajo. Un Hermes específico es una configuración sobre una librería común (§2.7), no un código distinto por empresa.

### Objetivos
1. Una flota declarada en YAML, con estado de salud y límites por agente.
2. Delegar trabajo a cualquier agente de la flota (corto, largo/asíncrono) y seguirlo hasta su fin.
3. Controlar: cancelar, pausar/reanudar, cambiar presupuesto, aprobar acciones sensibles.
4. Trazabilidad de extremo a extremo: una traza OTel que cruza procesos, auditoría y coste por agente.
5. Operación segura: permisos por rol, aprobación humana de acciones destructivas, credenciales por referencia.
6. Accesible desde chat (agent-web), desde clientes MCP (Claude Desktop) y, en fases posteriores, desde ACP.
7. **Controlar flujos y automatizaciones** de otros agentes (listar, lanzar, pausar, cancelar, inspeccionar) y fijar en caliente su política de ejecución (sandbox, §4).
8. **Generar agentes nuevos** desde plantillas aprobadas, con límites heredados del creador (§2.5).

### No objetivos
Ser un orquestador de negocio (la lógica de los flows sigue siendo de `agent-enterprise`; Hermes los **controla**, no los define, §2.6), reemplazar a `director-agent` en bk-agents (se evalúa su convergencia, §9), gestionar infraestructura (arrancar contenedores o pods: eso lo hacen `docker-agent`, `k8s-agent`, `fleet-agent`; Hermes los usa como agentes de la flota).

## 2. Arquitectura

```
Usuario / cliente MCP / ACP
        │
   ┌────▼─────────────────────────────────────────────┐
   │ Hermes (createBaseEngine + herramientas fleet_*)  │
   │  ├─ FleetRegistry   (fleet.yaml + estado + salud) │
   │  ├─ Conectores      (AgentConnector)              │
   │  ├─ RunStore        (tareas, resultados, auditoría)│
   │  ├─ PolicyEngine    (roles, aprobaciones, presupuesto)│
   │  └─ Observabilidad  (OTel, métricas, eventos)     │
   └────┬─────────────────────────────────────────────┘
        │ conectores
   agent-protocol (HTTP) · MCP (stdio/HTTP) · [ACP] · [subagent providers] · in-process
        ▼
   agentes de la flota
```

### 2.1 Paquete
`packages/hermes` → `@backendkit-labs/create-hermes` (librería + CLI `bk-hermes`). Peer: `agent-core`, `agent-protocol`; opcionales: `agent-web`, `mcp-server`, `agent-otel`.

### 2.2 `AgentConnector` (el contrato central)
```ts
export interface AgentConnector {
    readonly kind: 'protocol' | 'mcp' | 'acp' | 'in-process';
    describe(): Promise<AgentDescriptor>;                       // nombre, versión, capacidades, esquemas
    health(signal?: AbortSignal): Promise<HealthReport>;        // ok | degraded | down + latencia + detalle
    run(req: RunRequest, ctx: RunContext): Promise<RunHandle>;  // devuelve de inmediato un handle
}
export interface RunHandle {
    runId: string;
    result(): Promise<RunResult>;                               // resuelve al terminar
    status(): Promise<RunStatus>;                               // pending | running | done | failed | cancelled
    events?(): AsyncIterable<RunEvent>;                         // si el agente emite eventos en vivo
    cancel(reason?: string): Promise<void>;
}
export interface RunContext { traceparent?: string; tenantId?: string; principal: Principal; budgetUsd?: number; deadlineMs?: number }
```
Conectores de la fase 1: `ProtocolConnector` (sobre `AgentClient`: ya trae circuit breaker, reintentos, polling y `cancel`) y `McpConnector` (sobre `MCPClientManager`; cada herramienta MCP expuesta es una capacidad). Fase 2: `AcpConnector` y proveedores de SPEC-0005. `InProcessConnector` ejecuta un `AgentEngine` local (útil para pruebas y para agentes de la misma máquina).

### 2.3 `fleet.yaml`
```yaml
fleet: produccion
agents:
  - id: git-analyst
    connector: { kind: protocol, url: http://localhost:3300, apiKey: { env: GIT_ANALYST_KEY } }
    tags: [dev, read-only]
    limits: { maxConcurrent: 2, budgetUsdPerDay: 3, deadlineMs: 600000 }
    health: { intervalSec: 30, timeoutMs: 3000 }
    access: { roles: [dev, ops], approval: never }
  - id: devops
    connector: { kind: mcp, command: bk-mcp-jira }
    access: { roles: [ops], approval: always, capabilities: { deploy: { approval: always } } }
policies:
  approval: { default: ask }               # ask | never | always
  budget: { perRunUsd: 1, perDayUsd: 20 }
```
Las claves usan referencias (`{ env }`) de SPEC-0002 §4. Se valida con Zod; `bk-hermes validate fleet.yaml` informa errores con ruta.

### 2.4 Herramientas del modelo (`allowedTools` del agente Hermes)
| Herramienta | Efecto |
|---|---|
| `fleet_list` | agentes, tags, estado, carga |
| `fleet_info` | capacidades y esquemas de un agente |
| `agent_run` | lanza una capacidad; `wait: true|false`; devuelve `runId` o resultado |
| `agent_status` | estado y último evento de un run |
| `agent_result` | resultado de un run terminado |
| `agent_cancel` | cancela un run |
| `fleet_health` | salud agregada y circuit breakers |
| `fleet_budget` | gasto por agente y total del día |
| `agent_create` | crea un agente desde un blueprint y lo registra en la flota (§2.5); pasa por aprobación |
| `agent_retire` | retira un agente creado por Hermes (cancela sus runs, lo da de baja) |
| `flow_list` / `flow_run` / `flow_status` / `flow_cancel` | controlan flows de agentes de la flota (§2.6) |
| `policy_get` / `policy_set` | leen y fijan la política de ejecución (sandbox) de un agente (§4); solo hacia igual o más estricto sin aprobación |
| `job_list` / `job_cancel` | jobs en segundo plano de un agente |
Todas respetan roles y política; `agent_run` y `agent_cancel` pasan por `onToolApproval` según `access.approval`. Los resultados de agentes remotos se tratan como **contenido no confiable**: pasan por `promptInjectionGuardrail` y `secretLeakGuardrail`.

### 2.5 Aprovisionamiento y herencia de permisos
Un **blueprint** declara un agente que Hermes puede crear: plantilla base (las de `create-bk-agent` o un `AgentProfile` declarativo), herramientas permitidas, proveedor y modelo, política de ejecución (sandbox), presupuesto y caducidad (`ttl`). Los blueprints viven en el `fleet.yaml` (`blueprints:`) y solo se puede crear lo que un blueprint describe.
```yaml
blueprints:
  - id: report-writer
    template: single
    tools: [read_file, search_files]
    sandbox: { preset: read-only }
    limits: { budgetUsdPerDay: 1, ttlMinutes: 120 }
    approval: ask          # crear una instancia pide aprobación humana
```
**Regla de herencia (se comprueba en código, no solo se documenta):** la política del agente creado es igual o más estricta que la del creador en cada dimensión (modo del sandbox, red, raíces, nivel de aprobación, herramientas permitidas, presupuesto, profundidad de creación). Si el blueprint pide algo más amplio, `agent_create` falla con `POLICY_WIDER_THAN_PARENT` y la ampliación solo se concede por el camino de escalación de SPEC-0006 (aprobación, para esa creación). Una creación hecha sin aprobador (flujo sin humano) falla cerrado. Cada creación y baja queda en la auditoría con el creador, el blueprint y la política resultante.
Se limita el número de agentes creados vivos y la profundidad de creación (un agente creado no crea otros salvo que el blueprint lo permita).

### 2.6 Control de flujos
`FlowConnector` (conector de la flota) expone los flows de `agent-enterprise` de un agente como capacidades: lista de flows, lanzar con entrada, estado por paso, pausar, cancelar. Hermes **no ejecuta la lógica** del flow: la ejecuta el agente que lo aloja; Hermes lo dispara, lo vigila y lo detiene bajo política. Requiere que el agente publique sus flows en `info` (extensión de §4).

### 2.7 Hermes convencional y Hermes específico
`createHermes({ fleet, policies, blueprints, flows, plugins, interfaces })` sobre la librería común. Tres niveles, del mismo código:
1. **Convencional:** sin personalización; flota, delegación, control y políticas generales (H0–H1). Sirve tal cual para quien solo necesita supervisar agentes.
2. **Específico:** el convencional más los blueprints, flows, políticas y plugins de una empresa o vertical. Las verticales repetibles (contabilidad, soporte, devops…) se distribuyen como *presets* (un `fleet.yaml`, blueprints y plugins de partida) fuera del núcleo, no como paquetes nuevos por cliente; el núcleo es agnóstico de dominio.
3. **Ampliado con plugins:** cualquiera de los dos, con capacidades añadidas (§2.9).

### 2.8 Detección de carencias
Cuando una tarea o un paso de un flow no lo cubre ningún agente de la flota (`fleet_find` no encuentra una capacidad que encaje), Hermes emite el evento `fleet.gap` con la descripción de lo que falta. Según la política de la empresa, ocurre una de tres cosas, de menos a más autonomía:
- **Avisar:** informa al operador y no hace nada más (por defecto).
- **Crear desde un blueprint existente** que cubre la carencia (§2.5), con la aprobación que ese blueprint exija.
- **Proponer un blueprint nuevo:** Hermes redacta un borrador (herramientas, política, presupuesto) que queda *pendiente*; un operador lo revisa y, si lo aprueba, pasa a ser un blueprint del `fleet.yaml`. **El borrador no se puede usar para crear agentes mientras no esté aprobado**: lo que Hermes redacta es una propuesta, no una autorización. Además, su política se comprueba con la regla de herencia de §2.5 antes de aceptarse.
Así Hermes "detecta una carencia y genera un agente específico" sin poder concederse permisos a sí mismo. Cada carencia, propuesta, aprobación y creación queda auditada y enlazada (`gapId` → blueprint → agente).

### 2.9 Plugins de Hermes
Un plugin amplía un Hermes sin tocar su código, siguiendo el patrón de *seams* (definición + proveedor + consumidor) del análisis de deepseek-harness, **sin** adoptar su contenedor de dependencias:
```ts
export interface HermesPlugin {
    readonly name: string; readonly version: string;
    /** Lo que necesita para funcionar; Hermes lo concede o no según la política de la empresa. */
    readonly requires?: { tools?: string[]; network?: string[]; connectors?: string[]; events?: string[] };
    setup(api: HermesPluginApi): void | Promise<void>;
}
interface HermesPluginApi {
    registerTool(tool: ToolDefinition): void;               // herramientas para el modelo de Hermes
    registerConnector(kind: string, factory: ConnectorFactory): void;
    registerBlueprint(b: Blueprint): void;                  // sujeto a la regla de herencia
    registerPolicyRule(rule: PolicyRule): void;             // solo puede restringir, nunca ampliar
    on(event: HermesEvent, handler: (e) => void | Promise<void>): () => void;   // fleet.gap, run.done, budget.exceeded…
}
```
- **Se declaran** en `plugins:` del `fleet.yaml` (paquete npm o ruta local) y se cargan al arrancar; recargar en caliente queda fuera de alcance.
- **Mínimo privilegio:** un plugin solo recibe lo que declara en `requires` y la política concede; sus herramientas pasan por el sandbox y las aprobaciones como cualquier otra. Una regla de política de un plugin **solo puede restringir**.
- **Aislamiento de fallos:** un plugin que lanza o cuelga se desactiva y se registra; no tumba a Hermes ni a los agentes. Los manejadores de eventos tienen plazo.
- **Auditoría:** cada herramienta, conector, blueprint o regla que aporta un plugin queda registrada con su nombre y versión.
- Ejemplos: plugins de dominio (conector a un ERP, plantilla de informes), de observabilidad (exportar eventos), de política (reglas de presupuesto de la empresa) y de notificación (avisar por correo o chat al aparecer un `fleet.gap`).

### 2.10 Ejemplo ilustrativo: contabilidad de una empresa
*Es solo un ejemplo: el mecanismo es agnóstico de dominio y el núcleo de Hermes no conoce ninguno (lo mismo vale para soporte, devops, RR. HH., ventas…).* Un *preset* de contabilidad aporta cuatro agentes y un flow: `invoice-reader` (lee facturas), `ledger-classifier` (asigna cuentas), `reconciler` (concilia con el banco) y `reporter` (cierre y reportes); el flow `cierre-mensual` los encadena y Hermes lo lanza y vigila (§2.6). Un día llega una factura con retenciones fiscales que ningún agente sabe tratar: `fleet.gap` → Hermes propone el blueprint `tax-withholding` (solo lectura del libro, escritura en una carpeta de borradores, sin red, presupuesto propio) → el contador lo aprueba → Hermes crea el agente, lo añade al flow y lo retira por `ttl` si deja de usarse. Un plugin de ERP aporta el conector con el sistema contable.

## 3. Estado y persistencia (`RunStore`)
Fase 1: SQLite/JSON local con `runId`, `agentId`, capacidad, entrada (redactada), estado, tiempos, coste, `traceId`, principal y resultado. Al arrancar, Hermes **reconcilia** los runs `running`: pregunta al agente por `taskId`; si no existe, los marca `lost`. Interfaz `RunStore` para sustituirla por el log de sesión (SPEC-0004) en fases posteriores.

## 4. Control: extensiones a `agent-protocol` (v1.1, compatibles)
Hoy: `run`, `tasks/:id` (GET), `DELETE tasks/:id`, `health`, `info`. Se añaden, todas opcionales para el servidor:
1. `GET /v1/agent/tasks/:id/events` (SSE): eventos en vivo del run (`token`, `tool_call`, `tool_result`, `metrics`, `guardrail`, `done`).
2. `POST /v1/agent/control` `{ action: 'pause'|'resume'|'set_budget'|'drain', ... }`. `drain` deja de aceptar runs nuevos (para mantenimiento).
3. Cabecera `traceparent` (W3C) en `run`: el servidor crea la traza del run como hija (ver §6).
4. `GET /v1/agent/runs` (lista de runs activos y recientes) y `capabilities[].effects: 'read'|'write'|'external'` para que Hermes aplique política.
5. `info` incluye `limits`, `version`, `protocolMinor`, y la lista de flows publicados.
6. Control de ejecución: `POST /v1/agent/control` admite también `get_sandbox_policy` / `set_sandbox_policy` (el `SandboxPolicyConfig` JSON de SPEC-0006; `set` valida y aplica a la llamada siguiente, la respuesta incluye la `version`), `list_jobs` y `cancel_job` (el `JobRegistry` del engine). `set_sandbox_policy` hacia un modo más amplio exige aprobación.
7. `GET /v1/agent/audit`: decisiones del sandbox y del engine del agente (las mismas que su NDJSON), para la vista unificada de §5.
`AgentServer` conecta `cancel` con `engine.abort()` y las señales de SPEC-0002 (hoy el cancel solo marca la tarea).

## 5. Políticas
- **Roles:** `Principal { id, roles[] }` llega del transporte (JWT en agent-web, token en MCP). `access.roles` por agente y por capacidad. Sin rol → `FORBIDDEN`.
- **Aprobación:** `ask` (humano), `never`, `always`. Para capacidades `effects: 'external'` el valor por defecto es `ask`.
- **Presupuesto:** `perRunUsd` y `perDayUsd` por agente y global. El coste de un run se obtiene del agente (`meta.costUsd` en la respuesta) o se estima desde `metrics`. Al superar el diario, `agent_run` responde `BUDGET_EXCEEDED` y emite `budget_exceeded`. El diario se persiste en el `RunStore` (hoy `CostTracker` lo pierde al reiniciar).
- **Concurrencia:** `maxConcurrent` por agente con un bulkhead; sin cola infinita (rechaza con `AGENT_BUSY`).
- **Auditoría:** cada decisión (permitir, denegar, aprobar) a `auditLog` NDJSON con `principal`, `agentId`, `capability`, `runId`.
- **Auditoría unificada:** Hermes recoge las decisiones de cada agente (§4.7) y las suyas en una vista única: quién hizo qué, bajo qué política y con qué versión de esa política.
- **Aprobador de máquina:** las solicitudes de escalación de un agente supervisado (SPEC-0006 §3.3) pueden resolverse por la política de la empresa en Hermes, solo para esa llamada y sin aprobador humano si la política lo permite; sin política aplicable, falla cerrado.

## 6. Observabilidad
- Hermes abre un span `hermes.run` por solicitud; `agent_run` abre `hermes.agent_run` y envía `traceparent` al agente. El agente crea sus spans como hijos de ese contexto (**cambio en `agent-core`/`agent-otel`**: `Tracer.startRootSpan` acepta un contexto padre y `otelApiSpanExporter`/`otlpHttpSpanExporter` lo respetan, conservando `traceId`).
- Métricas: runs por agente/estado, latencia p50/p95, coste, circuit breaker abierto.
- Eventos `fleet.agent.down|up`, `fleet.budget.exceeded` por el `EventBus` (permiten disparar flows o webhooks).

## 7. Interfaces
1. **Chat/kanban:** `AgentServer` de `agent-web` con el engine de Hermes; el `MonitorBus` muestra los runs delegados.
2. **MCP:** `AgentMCPServer` expone `fleet_*`/`agent_*` para Claude Desktop y otros clientes.
3. **CLI:** `bk-hermes run <agente> <capacidad> --input '{...}'`, `bk-hermes fleet`, `bk-hermes health`.
4. **ACP** (fase 2): Hermes como agente ACP controlable desde editores.

## 8. Fases y criterios de aceptación

| Fase | Contenido | Aceptación |
|---|---|---|
| **H0 — MVP** | `FleetRegistry` + validación, `ProtocolConnector`, `McpConnector`, herramientas `fleet_*`/`agent_*`, health periódico, `RunStore` con reconciliación, roles + aprobación, guardrails sobre resultados remotos, auditoría, OTel local, chat en agent-web, `bk-hermes` | Con 2 agentes de prueba levantados: listar, ejecutar uno corto y uno largo (asíncrono), cancelar, ver salud, caída de un agente detectada < 2 intervalos y marcada `down`, reinicio de Hermes sin perder runs, acción `always` pide aprobación, rol sin permiso → `FORBIDDEN`. Sin API key (con `agent-testkit`) |
| **H1 — Control** | extensiones de `agent-protocol` §4 (incluidas política del sandbox y jobs), `traceparent`, eventos SSE en vivo, `drain`, presupuesto diario persistente, auditoría unificada | Una traza única Hermes → agente en Jaeger; `pause`/`resume`/`set_budget` surten efecto en un agente real; `set_sandbox_policy` cambia lo que el agente puede hacer en su llamada siguiente y deja decisión auditada; presupuesto diario sobrevive a reinicio |
| **H1b — Aprovisionamiento, flows y carencias** | blueprints, `agent_create`/`agent_retire` con herencia de permisos comprobada, `FlowConnector`, `createHermes`, `fleet.gap` con propuesta de blueprint pendiente de aprobación | Crear un agente desde un blueprint con aprobación; un blueprint más amplio que el creador falla con `POLICY_WIDER_THAN_PARENT`; sin aprobador no se crea nada; un flow de otro agente se lanza, se pausa y se cancela desde Hermes; el agente creado caduca por `ttl` y queda auditado; una tarea sin agente que la cubra emite `fleet.gap` y una propuesta de blueprint no se puede usar hasta que un operador la aprueba |
| **H1c — Plugins y presets** | `HermesPlugin` y su API, carga desde `fleet.yaml`, permisos `requires`, aislamiento de fallos, formato de preset independiente del dominio y un preset neutral de referencia (`pipeline`) | Un plugin añade una herramienta y un conector; uno que pide más de lo concedido no carga; uno que lanza no afecta al resto; una regla de plugin que intenta ampliar permisos se rechaza; dos presets de dominios distintos (p. ej. uno contable y otro de soporte, ambos de prueba) cargan con el mismo mecanismo y completan un flujo simulado con `agent-testkit`, sin cambios en el núcleo |
| **H2 — Interoperabilidad** | `AcpConnector`, proveedores Claude Code/Codex (SPEC-0005), Hermes como servidor ACP y MCP | Delegar una tarea a Claude Code y a un agente propio desde el mismo chat |
| **H3 — Continuables** | hijos con sesión (SPEC-0004/0005): `agent_send`, `agent_interrupt`, equipos con buzón y tablero | Conversación de varios turnos con un agente que sobrevive a reinicios |
| **H4 — Flota** | políticas globales, convergencia con `director-agent`, fleet/docker/k8s como agentes gestores (infraestructura), RunStore compartido | Alta/baja de infraestructura de un agente por Hermes con aprobación |

## 9. Preguntas abiertas
1. **¿`director-agent` es Hermes?** `director-agent` (bk-agents) ya tiene chat WS, RBAC por rol y especialistas vía MCP stdio. Propuesta: Hermes nace como librería reutilizable y `director-agent` se reimplementa encima cuando H1 esté estable (no se rompe nada antes).
2. **Dónde vive el RunStore en producción:** SQLite local en H0; Redis/SQL para varias instancias de Hermes queda para H4.
3. **Seguridad del canal:** H0 usa `apiKey` por agente (en referencia). mTLS o tokens firmados por agente quedan para H4.
4. **Nombre:** `hermes` está libre en el scope; confirmar antes de publicar.
5. **Dónde corre un agente creado:** *decidido (2026-10-23)* — in-process en H1b (más simple de confinar y de cerrar); procesos aparte con `agent-protocol` en H4.
6. **Quién define los blueprints:** el operador de la empresa, en `fleet.yaml`. Hermes puede **proponer** borradores (§2.8) pero no activarlos: solo valen tras la aprobación de un operador (si pudiera activarlos él, la herencia de permisos no valdría).
7. **Cuánta autonomía por defecto para carencias:** *decidido (2026-10-23)* — "avisar"; subir a "crear desde blueprint" o "proponer" es decisión explícita de la empresa.
8. **Formato de distribución de plugins y presets:** paquetes npm con el prefijo `hermes-plugin-*` / `hermes-preset-*`, o también rutas locales. Pendiente decidir si se verifican (firma) antes de cargar.

## 10. Riesgos
- Un agente remoto malicioso o comprometido devuelve contenido con instrucciones (inyección): mitigado con guardrails y tratamiento como dato; Hermes **no** ejecuta herramientas de otros agentes con sus propios permisos sin pasar por política.
- Dos fuentes de verdad de estado (RunStore y el agente): la reconciliación es por `taskId`; el agente manda.
- **Crear agentes como vía de escalada:** un agente (o un Hermes comprometido por inyección) crea otro con más permisos. Mitigado por la herencia comprobada en código (§2.5), blueprints definidos solo por el operador, aprobación y límites de número y profundidad.
- Crecimiento del alcance: H0 no incluye continuables, equipos ni ACP.
