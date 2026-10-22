# SPEC-0003: Hermes — plano de control de agentes

**Fecha:** 2026-10-22
**Estado:** Borrador
**Depende de:** SPEC-0002 (cancelación, jobs, credenciales por referencia); fases posteriores de SPEC-0004, SPEC-0005 y SPEC-0006
**Contexto:** `docs/notes/analisis-deepseek-harness-y-hermes.md`

## 1. Qué es y qué no es

**Hermes** es un agente supervisor construido con el propio framework (`createBaseEngine`) que registra, descubre, ejecuta, vigila y controla a los demás agentes: los creados con el framework y, más adelante, agentes externos (Claude Code, Codex, cualquier agente ACP).

### Objetivos
1. Una flota declarada en YAML, con estado de salud y límites por agente.
2. Delegar trabajo a cualquier agente de la flota (corto, largo/asíncrono) y seguirlo hasta su fin.
3. Controlar: cancelar, pausar/reanudar, cambiar presupuesto, aprobar acciones sensibles.
4. Trazabilidad de extremo a extremo: una traza OTel que cruza procesos, auditoría y coste por agente.
5. Operación segura: permisos por rol, aprobación humana de acciones destructivas, credenciales por referencia.
6. Accesible desde chat (agent-web), desde clientes MCP (Claude Desktop) y, en fases posteriores, desde ACP.

### No objetivos
Ser un orquestador de negocio (eso son los flows de `agent-enterprise`), reemplazar a `director-agent` en bk-agents (se evalúa su convergencia, §9), gestionar infraestructura (arrancar contenedores o pods: eso lo hacen `docker-agent`, `k8s-agent`, `fleet-agent`; Hermes los usa como agentes de la flota).

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
`packages/hermes` → `@backendkit-labs/hermes` (librería + CLI `bk-hermes`). Peer: `agent-core`, `agent-protocol`; opcionales: `agent-web`, `mcp-server`, `agent-otel`.

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
Todas respetan roles y política; `agent_run` y `agent_cancel` pasan por `onToolApproval` según `access.approval`. Los resultados de agentes remotos se tratan como **contenido no confiable**: pasan por `promptInjectionGuardrail` y `secretLeakGuardrail`.

## 3. Estado y persistencia (`RunStore`)
Fase 1: SQLite/JSON local con `runId`, `agentId`, capacidad, entrada (redactada), estado, tiempos, coste, `traceId`, principal y resultado. Al arrancar, Hermes **reconcilia** los runs `running`: pregunta al agente por `taskId`; si no existe, los marca `lost`. Interfaz `RunStore` para sustituirla por el log de sesión (SPEC-0004) en fases posteriores.

## 4. Control: extensiones a `agent-protocol` (v1.1, compatibles)
Hoy: `run`, `tasks/:id` (GET), `DELETE tasks/:id`, `health`, `info`. Se añaden, todas opcionales para el servidor:
1. `GET /v1/agent/tasks/:id/events` (SSE): eventos en vivo del run (`token`, `tool_call`, `tool_result`, `metrics`, `guardrail`, `done`).
2. `POST /v1/agent/control` `{ action: 'pause'|'resume'|'set_budget'|'drain', ... }`. `drain` deja de aceptar runs nuevos (para mantenimiento).
3. Cabecera `traceparent` (W3C) en `run`: el servidor crea la traza del run como hija (ver §6).
4. `GET /v1/agent/runs` (lista de runs activos y recientes) y `capabilities[].effects: 'read'|'write'|'external'` para que Hermes aplique política.
5. `info` incluye `limits`, `version`, `protocolMinor`.
`AgentServer` conecta `cancel` con `engine.abort()` y las señales de SPEC-0002 (hoy el cancel solo marca la tarea).

## 5. Políticas
- **Roles:** `Principal { id, roles[] }` llega del transporte (JWT en agent-web, token en MCP). `access.roles` por agente y por capacidad. Sin rol → `FORBIDDEN`.
- **Aprobación:** `ask` (humano), `never`, `always`. Para capacidades `effects: 'external'` el valor por defecto es `ask`.
- **Presupuesto:** `perRunUsd` y `perDayUsd` por agente y global. El coste de un run se obtiene del agente (`meta.costUsd` en la respuesta) o se estima desde `metrics`. Al superar el diario, `agent_run` responde `BUDGET_EXCEEDED` y emite `budget_exceeded`. El diario se persiste en el `RunStore` (hoy `CostTracker` lo pierde al reiniciar).
- **Concurrencia:** `maxConcurrent` por agente con un bulkhead; sin cola infinita (rechaza con `AGENT_BUSY`).
- **Auditoría:** cada decisión (permitir, denegar, aprobar) a `auditLog` NDJSON con `principal`, `agentId`, `capability`, `runId`.

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
| **H1 — Control** | extensiones de `agent-protocol` §4, `traceparent`, eventos SSE en vivo, `drain`, presupuesto diario persistente | Una traza única Hermes → agente en Jaeger; `pause`/`resume`/`set_budget` surten efecto en un agente real; presupuesto diario sobrevive a reinicio |
| **H2 — Interoperabilidad** | `AcpConnector`, proveedores Claude Code/Codex (SPEC-0005), Hermes como servidor ACP y MCP | Delegar una tarea a Claude Code y a un agente propio desde el mismo chat |
| **H3 — Continuables** | hijos con sesión (SPEC-0004/0005): `agent_send`, `agent_interrupt`, equipos con buzón y tablero | Conversación de varios turnos con un agente que sobrevive a reinicios |
| **H4 — Flota** | políticas globales, convergencia con `director-agent`, fleet/docker/k8s como agentes gestores | Alta/baja de un agente por Hermes con aprobación |

## 9. Preguntas abiertas
1. **¿`director-agent` es Hermes?** `director-agent` (bk-agents) ya tiene chat WS, RBAC por rol y especialistas vía MCP stdio. Propuesta: Hermes nace como librería reutilizable y `director-agent` se reimplementa encima cuando H1 esté estable (no se rompe nada antes).
2. **Dónde vive el RunStore en producción:** SQLite local en H0; Redis/SQL para varias instancias de Hermes queda para H4.
3. **Seguridad del canal:** H0 usa `apiKey` por agente (en referencia). mTLS o tokens firmados por agente quedan para H4.
4. **Nombre:** `hermes` está libre en el scope; confirmar antes de publicar.

## 10. Riesgos
- Un agente remoto malicioso o comprometido devuelve contenido con instrucciones (inyección): mitigado con guardrails y tratamiento como dato; Hermes **no** ejecuta herramientas de otros agentes con sus propios permisos sin pasar por política.
- Dos fuentes de verdad de estado (RunStore y el agente): la reconciliación es por `taskId`; el agente manda.
- Crecimiento del alcance: H0 no incluye continuables, equipos ni ACP.
