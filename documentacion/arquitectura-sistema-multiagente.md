# Arquitectura del Sistema Multi-Agente

## Visión

Que una empresa pueda funcionar en su mayoría con agentes autónomos, y los humanos solo auditen y aprueben.

El humano no desaparece — **sube de nivel**: de ejecutar tareas a definir políticas y aprobar excepciones. Los agentes operan el día a día; los humanos gobiernan el sistema.

| Rol humano hoy | Rol humano con el sistema |
|---|---|
| Ejecuta tareas repetitivas | Define políticas en el vault |
| Toma todas las decisiones | Aprueba solo las de alto impacto |
| Genera reportes | Audita reportes generados por agentes |
| Responde incidentes | Recibe resumen + plan ya ejecutado |
| Incorpora empleados | Aprueba el checklist completado por agentes |

---

## Niveles de autonomía

No todo proceso puede ser igual de autónomo. El sistema define un espectro por workflow:

```
NIVEL 0 — Asistencia
  Humano hace todo, agente sugiere
  Ejemplo: agente redacta email, humano lo envía

NIVEL 1 — Propuesta
  Agente propone plan completo, humano aprueba antes de ejecutar
  Ejemplo: plan de onboarding, análisis de impacto

NIVEL 2 — Ejecución con gate
  Agente ejecuta, se detiene en decisiones críticas para aprobación
  Ejemplo: procesa nómina → gate antes de acreditar

NIVEL 3 — Ejecución autónoma con auditoría posterior
  Agente ejecuta completo, humano revisa el resultado después
  Ejemplo: generación de reportes, análisis rutinarios

NIVEL 4 — Autónomo con alertas de excepción
  Agente opera, solo interrumpe al humano si algo está fuera de rango
  Ejemplo: monitoreo, reconciliaciones, detección de anomalías
```

El nivel se configura por workflow en `orchestrator.yaml`. Un mismo sistema puede tener workflows en nivel 2 (nómina) y nivel 4 (reportes internos) simultáneamente.

---

## Lógica de escalación del agente

Antes de actuar, cada agente evalúa si puede proceder solo. Las verificaciones tienen **precedencia estricta** — la reversibilidad se evalúa primero y no puede ser anulada por las demás:

```
Agente recibe subtarea
  │
  1️⃣ ¿El impacto es reversible?
  │     irreversible             → gate obligatorio, SIN EXCEPCIÓN
  │                                (ninguna política ni confianza lo libera)
  │     reversible               → continúa al paso 2
  │
  2️⃣ Políticas aplicables (carga determinística, NO vía RAG)
  │     política dice autónomo   → continúa al paso 3
  │     política dice gate       → abre ComplianceGate
  │     no hay política          → escala (incertidumbre = humano)
  │
  3️⃣ ¿Verificación del resultado pasa?
        resultado verificable     → ejecuta
        no verificable / dudoso   → escala con razonamiento adjunto
```

**Nota sobre confianza**: la auto-confianza reportada por un LLM está mal calibrada por naturaleza — un agente alucinando suele reportar alta confianza. Por eso el paso 3 usa **verificación cruzada** en lugar de auto-reporte: ¿el resultado cita notas del vault que existen?, ¿los números cuadran con las fuentes?, ¿las referencias son verificables? La verificación es determinística donde se puede, y solo cae en juicio del LLM donde no hay alternativa.

---

## El framework como pieza central

El framework (`@backendkit-labs/agent-core`) es la base de todo el sistema. Es quien crea y corre cada agente individual. Todo lo demás — vault, RAG, BullMQ, orquestador — son capas que se construyen encima.

```
@backendkit-labs/agent-core        ← FRAMEWORK: crea y corre agentes
         │
         └── @backendkit-labs/agent-enterprise  ← extiende con RAG, vault, flows
                  │
                  └── orchestrator-agent         ← coordina múltiples agentes
                           │
                           └── BullMQ Workers    ← cada worker ES un agente del framework
                                    │
                                    └── Vault    ← conocimiento compartido
```

### Lo que aporta el framework a cada agente

- **AgentEngine** — el loop de razonamiento: think → act → observe
- **ToolRegistry** — herramientas disponibles (`search_knowledge`, `write_knowledge`, custom tools)
- **ProviderRegistry** — qué LLM usa cada agente (Ollama local, DeepSeek, Anthropic)
- **Transport** — canal de comunicación (WebSocket, Callback, Telegram, stdio)
- **Memory** — episódica, semántica y procedural entre turnos
- **AgentProfile** — identidad, capacidades y system prompt del agente

### La relación framework → worker

Cada worker de BullMQ es un agente del framework corriendo en modo worker:

```typescript
worker.process(job) {
  const agent = framework.createAgent(job.agentId)  // framework instancia el agente
  const result = await agent.run(job.task)           // framework maneja el loop LLM
  vault.write(result)                                // enterprise persiste el resultado
}
```

El orquestador decide *qué agente hace qué*. El framework decide *cómo ese agente razona y actúa*. Sin el framework, el orquestador solo distribuye strings. Con el framework, distribuye agentes que razonan, usan herramientas y acumulan memoria.

---

## Origen y contexto

El sistema nació como un framework de agentes con LLMs locales alimentados por información almacenada en un vault de Obsidian, compartido por todos los agentes mediante búsquedas RAG.

---

## Ecosistema actual

Mapa de lo que existe y corre hoy. Cada agente especialista expone un MCP server (stdio); el director los consume como cliente.

```
                        ┌──────────────────────────────────────────────────┐
                        │               director-agent  :3500              │
                        │  LLM coordinator — WebSocket front-door de chat  │
                        │  RBAC: JWT (auth-service) + access_control.yaml  │
                        └──────┬───┬───┬───┬───┬───┬───┬───┬───┬──────────┘
                               │   │   │   │   │   │   │   │   │
           ┌───────────────────┘   │   │   │   │   │   │   │   └────────────────────┐
           │           ┌───────────┘   │   │   │   │   │   └────────────┐           │
           │           │       ┌───────┘   │   │   │   └──────┐         │           │
           ▼           ▼       ▼           ▼   ▼   ▼          ▼         ▼           ▼
        codex         runs   coder       cloud fleet project config  scheduler  notifier
   (vault RAG)  (orchestr.) (bk-coder)  (mcp) (gateway)  (workspace) (agent)  (agent)
                                           │     │
                                           ▼     ▼
                                    cloud-platform  orchestrator-gateway
                                    (NestJS :3100)  (HTTP :3400)
                                           │               │
                                      Docker/k8s    orchestrator-mcp-agent
                                    (runtime SPI)    (flows, gates, runs)
```

### Agentes conectados al director

| Nombre en director.yaml | Proyecto | Qué hace |
|---|---|---|
| `codex` | `codex-context-agent-v2` | Vault RAG: search, curate, read, reindex |
| `runs` | `orchestrator-mcp-agent` | Flows de negocio, gates, estado de runs |
| `coder` | `bk-coder-v2/orchestrator` | SDD spec-driven: diseño → código → QA |
| `cloud` | `cloud-mcp` → `cloud-platform` | Infraestructura: departments, deployables, workflows |
| `fleet` | `fleet-agent` → `orchestrator-gateway` | Deploy Docker/k8s vía HTTP gateway |
| `project` | `bk-coder-v2/workspace-manager-project` | Proyectos, root, config de agentes |
| `config` | `config-agent` | Configuración centralizada + secretos de agentes |
| `scheduler` | `schedule-agent` | Tareas one-time y cron → dispara flows |
| `health` | `health-checker` | Salud del ecosistema: orquestador, agentes, env, vault |
| `notifier` | `notification-agent` | Email, Slack, Telegram, Discord, push |

### Servicios de infraestructura

| Servicio | Stack | Puerto | Rol |
|---|---|---|---|
| `auth-service` | Next.js 14 + SQLite/Turso | 4000 | Autenticación JWT, gestión de usuarios, roles y tools RBAC |
| `cloud-platform` | NestJS + TypeORM + Postgres | 3100 | Control plane: departments, deployables, catalog, workflows, runtime adapters |

---

## Componentes principales

### 1. Vault (Obsidian / filesystem)

Fuente de verdad del dominio de negocio. Contiene conocimiento humano y salidas de agentes:

```
vault/
  arquitectura/       ← decisiones técnicas, diagramas
  patrones/           ← cómo hacemos las cosas
  lecciones/          ← errores y aprendizajes
  agentes/            ← lo que los agentes producen (VaultWriter)
  eventos/            ← audit trail automático (EventPublisher)
  auditoria/          ← logs de ComplianceGate por flow/run
```

La calidad de las respuestas de los agentes es directamente proporcional a la calidad y cantidad de notas en el vault. Un vault vacío da agentes genéricos; un vault bien curado da agentes con memoria institucional real.

### 2. Vector Index (RAG)

Índice de búsqueda semántica sobre el vault:

- Hoy: JSON monolítico en `~/.bk-agent/rag/<vault-name>.json`
- Futuro: LanceDB (embebido, TypeScript nativo, búsqueda ANN)
- Actualización incremental por `mtime` (solo re-indexa archivos modificados)
- Búsqueda por cosine similarity (+ BM25 en roadmap)

### 3. Director Agent + Orchestrator

La coordinación se reparte en dos capas con responsabilidades distintas:

**Director Agent** — inteligencia central y cara conversacional. No ejecuta tareas técnicas: las delega. Conecta vía MCP (stdio) a todos los agentes especialistas. Expone un WebSocket en `:3500` como front-door de chat.

```
Usuario: "Onboarding de María García, entra el lunes"
  │
  ▼
Director (LLM + herramientas de todos los agentes)
  → codex: busca el proceso de onboarding en el vault
  → runs: inicia el flow "onboarding-empleado"
  → cloud: verifica que el deployable "hr-agent" esté corriendo
  → notifier: envía confirmación al manager
```

**Orchestrator MCP Agent** (`runs`) — descompone flows en subtareas, coordina agentes especialistas y gestiona gates y checkpoints. Es la capa de *cómo ejecutarlo*:

```
run_flow("onboarding-empleado", { nombre: "María", depto: "backend" })
  → t1: hr-agent   → "crear expediente"
  → t2: it-agent   → "provisionar accesos"  (depends: t1)
  → gate: manager aprueba antes de continuar
  → t3: legal-agent → "firmar contratos"    (depends: t1)
  → t4: writer      → "enviar email bienvenida" (depends: t2, t3)
```

Tools del orchestrator-mcp-agent expuestas al director:
- `run_flow` / `start_flow` — inicia un flow definido en config
- `run_task` — tarea ad-hoc sin flow predefinido
- `run_status` — estado de una ejecución (checkpoint)
- `list_runs` — historial de runs

### 4. Agentes especialistas

Cada agente recibe:
- **System prompt**: quién es y qué hace
- **Vault context**: lo que el negocio ya sabe (vía RAG)
- **Task context**: resultados de agentes anteriores en el mismo flow

Cada agente puede tener asignado un provider distinto según la sensibilidad de los datos:

| Tipo de dato | Provider | Motivo |
|---|---|---|
| Personal (RRHH, pagos, legal) | `local` (Ollama) | Nunca sale de la empresa |
| Razonamiento, reportes, código | `deepseek` o `anthropic` | Mayor calidad |

### 5. Auth Service

Servicio de identidad del ecosistema. Emite JWTs que el director usa para RBAC.

- **Stack**: Next.js 14 + Drizzle + SQLite / Turso cloud
- **Puerto**: 4000
- **JWT payload**: `role`, `tools[]` (tools del director que puede invocar), `vault[]` (namespaces del vault), `apps[]` (director, vault-manager), `dept`
- **Setup inicial**: `POST /api/setup` crea el primer admin (endpoint se cierra automáticamente tras el primer uso)
- **Lockout**: 5 intentos fallidos → bloqueo 5 minutos

El director valida el JWT de cada usuario y hace cumplir `access_control.yaml` usando las `tools[]` del payload.

### 6. Cloud Platform

Control plane de infraestructura para el ecosistema. Gestiona el ciclo de vida de agentes y apps como unidades desplegables.

- **Stack**: NestJS + TypeORM + PostgreSQL
- **Puerto**: 3100
- **Runtime adapters**: Docker (disponible), k8s (disponible), process (coming soon)
- **Auth**: `FlexAuthGuard` — acepta JWT o `X-Api-Key` (M2M para el director)

Dominios:

| Módulo | Responsabilidad |
|---|---|
| `Departments` | Unidades organizativas con secrets cifrados inyectados en runtime |
| `Deployables` | Instancias de agentes/apps con estado de runtime (pending→running→stopped) |
| `Catalog` | Templates reutilizables con `requiredSecrets` — validados antes del deploy |
| `Workflows` | Pipelines multi-step con trigger manual/webhook/scheduled |
| `Director` | Runtime adapter: deploy, stop, logs, metrics, exec |
| `ApiKeys` | Credenciales M2M `bkc_xxx` — stored as SHA-256, mostradas una sola vez |

El director accede vía `cloud-mcp` (MCP stdio) con 17 tools: `list_departments`, `cloud_deploy`, `cloud_stop`, `run_workflow`, etc.

---

## Flujo de punta a punta

```
Usuario
  │  tarea en lenguaje natural
  ▼
┌─────────────────────────────────────────┐
│         Orchestrator Agent (MCP)        │
│  1. RAG search sobre el vault           │
│  2. LLM genera plan (DAG de subtareas)  │
│  3. Checkpoint guardado                 │
└──────────┬──────────┬──────────┬────────┘
           │          │          │
           ▼          ▼          ▼
      [agent-1]  [agent-2]  [agent-3]
           │          │          │
      cada agente:
        1. RAG search (search_knowledge)
        2. Ejecuta su subtarea
        3. Escribe resultado al vault (write_knowledge)
           │
           ▼
      [agent-4]  ← recibe resultados de t1, t2, t3 como contexto
           │
           ▼
      Resultado consolidado
```

---

## Loop de inteligencia acumulativa

```
Ronda 1 (vault vacío):
  RAG → pocas notas → respuesta genérica

Ronda N (vault maduro):
  RAG → decisiones previas, errores pasados,
         análisis anteriores, patrones del negocio
  → respuesta con memoria institucional real
```

Cada ejecución enriquece el vault, lo que mejora la próxima ejecución. Es un flywheel: más uso → más notas → mejores respuestas → más uso.

### El lado oscuro del flywheel: envenenamiento del vault

El flywheel también amplifica errores: una alucinación escrita con `write_knowledge` se convierte en "memoria institucional" que el RAG recupera para siempre, con la misma autoridad que una nota humana. Sin defensa, el vault degrada en vez de mejorar. Las contramedidas:

1. **Provenance en el ranking**: el frontmatter ya registra `author: agent/{id}` — el retrieval pondera por origen:
   ```
   nota humana            → peso completo
   nota de agente revisada → peso completo
   nota de agente sin revisar → peso reducido + marcada en el contexto
                               como "[no verificado]"
   ```
2. **Curación como gate de nivel 3**: las notas de agentes nacen en estado `draft`; un humano (o un agente revisor distinto al autor) las promueve a `verified`. Las notas `draft` son recuperables pero el LLM las ve etiquetadas.
3. **Caducidad**: notas de agente sin revisar más viejas que N días bajan de peso o salen del índice — lo no verificado no se acumula indefinidamente.

---

## Paquetes del framework

### `packages/core`

Base de todo agente. Define el loop de razonamiento y la infraestructura de tools.

| Módulo | Responsabilidad |
|---|---|
| `AgentEngine` | Loop think → act → observe |
| `ToolRegistry` | Registro y despacho de herramientas |
| `ProviderRegistry` | Abstracción de LLM providers (OpenAI-compatible) |
| `Transport` | Canales: WebSocket, Callback, stdio |
| `Memory` | Episódica, semántica y procedural entre turnos |

### `packages/enterprise`

Extensión con capacidades de negocio. Usa `core` como base.

| Módulo | Responsabilidad |
|---|---|
| `events/EventPublisher` | Publica eventos a Redis (BullMQ) + vault simultáneamente |
| `events/ReconciliationSweeper` | Reconcilia eventos publicados vs. notas en vault |
| `flow/FlowRunner` | Ejecuta flujos declarativos YAML (estáticos) |
| `flow/ComplianceGate` | Fuerza evaluador ≠ ejecutor, evidencia requerida |
| `rag/ObsidianRAGProvider` | Orquestador RAG de alto nivel |
| `rag/VaultIndexer` | Escaneo incremental y chunking del vault |
| `rag/VectorStore` | Índice en memoria (JSON file-backed) |
| `rag/VaultWriter` | Escribe notas Markdown al vault con frontmatter |

### `packages/mcp-server`

SDK para construir MCP servers con las convenciones de BackendKit. Base de todos los agentes especialistas.

### `packages/coding`

Utilidades compartidas entre agentes de código (bk-coder-v2, design-agent, etc.).

### `agents/director-agent`

Delivery layer del coordinador. Implementa el loop LLM del director, el WebSocket server, el sistema de acceso (JWT + RBAC + vault visibility) y la conexión MCP a todos los especialistas.

| Módulo | Responsabilidad |
|---|---|
| `src/server.ts` | WebSocket server + bootstrap de conexiones MCP |
| `src/director.ts` | Loop principal LLM + tool dispatch |
| `src/mcpManager.ts` | Gestión del ciclo de vida de procesos MCP hijo |
| `src/access.ts` | Evaluación de `access_control.yaml` (RBAC capa 1+2) |
| `src/registry.ts` | Mapa de labels de agentes para el usuario |
| `director.yaml` | Config: providers, agents, RBAC, vault visibility, audit |

### `agents/orchestrator-mcp-agent`

Delivery layer del orquestador. Descompone flows en subtareas y coordina agentes especialistas.

| Módulo | Responsabilidad |
|---|---|
| `src/planner.ts` | TaskPlanner: LLM genera el plan como DAG |
| `src/executor.ts` | PlanExecutor: ejecución topológica del plan |
| `src/provider.ts` | OpenAICompatibleProvider con retry exponencial |
| `src/server.ts` | MCP server con tools: `run_flow`, `run_task`, `run_status`, `list_runs` |
| `src/config.ts` | Carga y valida `orchestrator.yaml` |

---

## Dos modos de orquestación

| | FlowRunner (estático) | TaskPlanner (dinámico) |
|---|---|---|
| **Cómo se define** | YAML con pasos fijos | LLM decide los pasos en runtime |
| **Cuándo usar** | Procesos regulados, aprobaciones, compliance | Tareas exploratorias, análisis ad-hoc |
| **Fault tolerance** | Sin checkpoint (hoy) | Checkpoint por subtarea |
| **Gates** | Pre-configurados por paso en el YAML | **Gates por defecto en toda acción con efectos** |

Son complementarios: estáticos para procesos con pasos conocidos, dinámicos para cuando no sabés de antemano cuántos pasos necesitás.

### Gates por defecto en planes dinámicos

El modo dinámico es el de mayor riesgo (el LLM inventa el plan) y por eso **no puede tener la menor protección**. La regla invierte la carga de la prueba:

```
En un plan generado por TaskPlanner:
  subtarea solo-lectura (RAG search, análisis, redacción)
    → ejecuta sin gate
  subtarea con efectos (escritura externa, pagos, emails,
                        modificación de datos, llamadas a APIs)
    → gate OBLIGATORIO por defecto
    → solo una política explícita en /politicas/ puede liberarla
```

La validación estructural (Capa 1) verifica IDs y ciclos pero **no inspecciona el contenido de las tareas** — un plan estructuralmente perfecto puede contener una subtarea destructiva. Por eso el gate por defecto se aplica según las *tools* que la subtarea requiere, no según su descripción en lenguaje natural: si el agente asignado tiene herramientas con efectos, la subtarea hereda gate. La autonomía se gana por política, no se asume.

---

## Storage y BullMQ: estado actual vs. diseño objetivo

### Estado actual

BullMQ y Redis están **subutilizados**. Solo sirven como audit log a través de `EventPublisher`:

```
publish(event)
  ├─► BullMQ Queue (Redis) → publica el evento  ← nadie consume esta queue
  └─► Vault /eventos/*.md  → audit trail RAG-queryable
```

El flujo principal del orquestador es **completamente sincrónico** — no usa BullMQ en ningún punto:

```
run_flow(flowId, input)
  → FlowRunner ejecuta pasos en orden → llama LLM por cada uno → espera
  → consolida → retorna
```

Los workers que deberían consumir las queues de BullMQ no existen todavía. Es infraestructura declarada sin consumidor.

**Lo que sí está construido y corre hoy:**
- Director-agent con RBAC completo (JWT + access_control.yaml + vault visibility + audit)
- 10 agentes especialistas conectados via MCP (ver tabla en "Ecosistema actual")
- Auth-service: autenticación, usuarios, roles con tools RBAC
- Cloud-platform: runtime SPI completo (Docker + k8s), departments, deployables, catalog, workflows, API keys M2M
- orchestrator-mcp-agent: flows sincrónicos, gates, checkpoints, recovery daemon
- fleet-agent: deploy vía orchestrator-gateway HTTP

### Diseño objetivo: BullMQ como coordinador de agentes

Para paralelismo real entre subtareas independientes:

```
orchestrator_run(task)
  → TaskPlanner genera plan (DAG)
  → PlanExecutor publica cada subtarea como job:
        queue: "subtasks.architect"    → job: {task, context, runId}
        queue: "subtasks.data-analyst" → job: {task, context, runId}
        queue: "subtasks.risk"         → job: {task, context, runId}

Workers (uno por tipo de agente, corriendo en paralelo):
  → consumen su queue
  → buscan en vault via RAG
  → ejecutan contra LLM (local o cloud según config de privacidad)
  → escriben resultado al vault (VaultWriter)
  → publican evento "subtask.completed" de vuelta

PlanExecutor:
  → espera eventos de completion para cada job
  → libera subtareas dependientes cuando sus deps están completas
  → consolida resultados finales
```

| Componente | Hoy | Objetivo |
|---|---|---|
| BullMQ | Audit log de eventos, sin consumidores | Cola de trabajo para subtareas entre agentes |
| Redis | Solo backend de BullMQ | Estado del run + resultados intermedios + cache de embeddings |
| Storage vault | Markdown + JSON index | Vault como fuente de verdad, LanceDB como índice |

No hay transacción distribuida. `ReconciliationSweeper` compara jobs publicados vs. notas en vault para detectar subtareas huérfanas (publicadas pero no procesadas).

### Contexto entre agentes: por Redis, NO por RAG

Hay una race condition si los resultados entre subtareas del mismo run viajan por el vault: el agente t1 escribe su nota, pero el índice RAG se actualiza de forma incremental — **la nota escrita hace 5 segundos probablemente no está indexada cuando t2 busca**. El resultado: t2 ejecuta sin el contexto de t1 y nadie se entera.

La regla de separación:

```
Contexto del run (efímero):
  resultado de t1 → Redis (key: run:{runId}:results:{taskId})
                  → inyectado directo en el payload del job de t2
  El agente t2 NO busca los resultados de t1 vía RAG.

Memoria de largo plazo (permanente):
  resultado de t1 → vault via VaultWriter
                  → indexado eventualmente
                  → disponible para runs FUTUROS, no para el actual
```

El vault es memoria institucional; Redis es la mesa de trabajo del run en curso.

### Ejecución durable: `orchestrator_run` retorna inmediato

El modelo MCP request/response choca con workflows de larga duración: un gate de aprobación humana puede tardar horas o días, y ninguna llamada MCP sincrónica sobrevive eso. El contrato cambia:

```
orchestrator_run(task)
  → valida, genera plan, persiste estado inicial
  → retorna INMEDIATAMENTE: { runId, plan, status: "running" }

El run vive como state machine en Redis/BullMQ:
  estado: { runId, plan, completed: [...], pending: [...],
            waiting_gates: [...], status }

orchestrator_status(runId)
  → consulta el estado en cualquier momento

Aprobación de gate
  → es un EVENTO que despierta al executor
  → el executor publica los jobs que el gate bloqueaba
  → nadie mantiene una conexión abierta esperando
```

El checkpoint actual es la semilla de este modelo, pero el cambio es estructural: el run no pertenece a ninguna llamada — pertenece a la infraestructura.

---

## Problemas actuales y roadmap de mejoras

### Críticos (corto plazo)

1. **VectorStore → LanceDB**: elimina búsqueda O(n) lineal y el JSON monolítico como single-file bottleneck
2. **OllamaEmbedder**: agregar retry con backoff exponencial y timeout (portar de `OpenAICompatibleProvider`)
3. **VaultWriter**: agregar file locking para escrituras concurrentes entre agentes

### Siguiente iteración

4. **Hybrid RAG (BM25 + dense + RRF)**: las notas de Obsidian tienen tags y términos exactos que cosine similarity sola pierde
5. **Hierarchical chunking**: chunks pequeños para retrieval, chunks padres para contexto al LLM
6. **CheckpointStore en enterprise**: para que FlowRunner también pueda retomar ejecuciones interrumpidas

### Después

7. **Query rewriting**: reformular la query antes de embedar (1 LLM call extra, recuperación mucho mejor)
8. **VaultWriter → cola BullMQ**: serializar escrituras concurrentes al vault

---

## Patrones de RAG aplicables (referencia)

Del análisis de arquitecturas RAG:

| Patrón | Aplica | Motivo |
|---|---|---|
| **Hybrid RAG** | Sí, prioritario | Notas Obsidian tienen keywords exactas |
| **Advanced RAG** | Sí, chunking | Hierarchical chunks mejoran precision/recall |
| **Modular RAG** | Sí, Embedder | Intercambiar SimpleEmbedder ↔ OllamaEmbedder ↔ futuro |
| GraphRAG | No por ahora | Overhead alto para ganancia incierta en este vault |
| Agentic RAG | No | Ya hay agentes encima; agregar loop interno multiplica latencia |

---

## Workflows por caso de uso

El orquestador soporta dos modelos de workflow que coexisten:

### Workflows pre-definidos (estáticos)

Para casos conocidos y repetitivos. El orquestador detecta el tipo de tarea mediante el router y ejecuta el flow correspondiente directamente, sin invocar al TaskPlanner.

```
orchestrator.yaml
  workflows:
    - id: onboarding-empleado
      trigger: "onboarding|nuevo empleado|alta de personal"
      agents: [hr, it-setup, legal, welcome-writer]
      flow: flows/onboarding.yaml

    - id: analisis-impacto
      trigger: "impacto|cambio|migración|modificación"
      agents: [architect, data-analyst, risk, writer]
      flow: flows/analisis.yaml

    - id: reporte-mensual
      trigger: "reporte|informe mensual|cierre"
      agents: [data-analyst, finance, report-writer]
      flow: flows/reporte.yaml

    - id: incidente-produccion
      trigger: "incidente|error|caída|alerta"
      agents: [sre, developer, communicator]
      flow: flows/incidente.yaml      ← prioridad alta en BullMQ

    - default: dynamic                ← si no matchea ninguno, TaskPlanner
```

Cada workflow tiene su prioridad en BullMQ. Un incidente de producción no espera detrás de un reporte mensual.

| Workflow | Agentes | Prioridad queue | ComplianceGate |
|---|---|---|---|
| `onboarding-empleado` | hr, it, legal, writer | normal | legal aprueba antes de continuar |
| `analisis-impacto` | architect, analyst, risk, writer | normal | no |
| `reporte-mensual` | analyst, finance, writer | baja | finance valida cifras |
| `incidente-produccion` | sre, dev, comms | alta | no — velocidad primero |
| `dynamic` | los que el LLM decida | normal | **sí — gate por defecto en toda acción con efectos** |

### Workflow dinámico (TaskPlanner)

Para tareas exploratorias o que no encajan en ningún caso conocido. El LLM genera el DAG en runtime.

### Estructura de archivos

```
packages/orchestrator-agent/
  orchestrator.yaml
  flows/
    onboarding.yaml
    analisis-impacto.yaml
    reporte-mensual.yaml
    incidente-produccion.yaml
  src/
    router.ts       ← detecta qué workflow usar (LLM clasificador, regex como hint)
    planner.ts      ← fallback dinámico cuando no matchea ningún workflow
    executor.ts     ← corre el flow elegido
```

### El router: clasificación por LLM, regex solo como hint

El matching por regex puro es frágil: la tarea *"analizá este error de cálculo en el reporte mensual"* matchea `error` y se iría al workflow de incidentes con prioridad alta, cuando pertenece al de reportes. Las reglas del router:

1. **El clasificador primario es un LLM** con la lista de workflows y sus descripciones — la regex del trigger es solo un hint que se le pasa como contexto
2. **Match múltiple o ambiguo** → el router pregunta al usuario en vez de adivinar
3. **Confianza baja del clasificador** → cae al modo dinámico (TaskPlanner), que es el camino seguro porque tiene gates por defecto

El vault es compartido entre todos los workflows. Un agente en `analisis-impacto` puede leer notas que dejó `incidente-produccion` semanas atrás.

---

## Resiliencia del TaskPlanner frente a alucinaciones

El TaskPlanner es el punto de falla más peligroso: si el LLM alucina, sus errores se propagan a todos los agentes downstream. El sistema usa defensas en capas.

### Tipos de alucinación posibles

```
TaskPlanner puede generar:
  { agent_id: "agente-que-no-existe" }   ← agente inválido
  { depends_on: ["t5"] }                 ← dependencia a ID inexistente
  { id: "t3", depends_on: ["t3"] }       ← ciclo infinito
  { task: "borrar todos los registros" } ← acción destructiva
  // plan incompleto, falta un nodo del DAG
```

### Capa 1 — Validación estructural determinística

Antes de publicar cualquier job en BullMQ, el plan completo se valida:

- Todos los `agent_id` existen en `orchestrator.yaml`
- Todos los IDs en `depends_on` referencian subtareas del mismo plan
- El grafo no tiene ciclos (topological sort — si falla, hay ciclo)
- El plan tiene al menos una subtarea sin dependencias (punto de entrada)

Si falla → no se publica ningún job. El error se devuelve al LLM.

### Capa 2 — Retry con feedback explícito al LLM

```
Intento 1: LLM genera plan → validación falla
           error: "agente 'security-agent' no existe.
                   Agentes disponibles: [architect, analyst, risk, writer]"
               │
               ▼
Intento 2: LLM recibe error + lista exacta de agentes válidos → replantea
               │
               ▼
Intento 3: si sigue fallando → fallback a workflow estático
           si no hay workflow estático → error al usuario
```

Máximo 3 intentos. El prompt del TaskPlanner siempre incluye la lista exacta de agentes disponibles — el LLM no puede inventar uno nuevo que pase la validación.

### Capa 3 — Lista blanca de agentes (whitelist)

El LLM solo puede asignar agentes declarados en config. La validación es determinística, no semántica. Ningún agente se ejecuta si no está en la whitelist.

### Capa 4 — ComplianceGate para acciones irreversibles

Para pasos que tocan datos críticos o ejecutan acciones destructivas, un evaluador externo (humano u otro agente) aprueba antes de que el siguiente job se publique en BullMQ:

```
t1: analyst → "identificar registros a archivar"
  └─► ComplianceGate: supervisor aprueba la lista    ← pausa aquí
t2: data-agent → "ejecutar archivado"                ← solo si gate pasó
```

### Capa 5 — Confirmación humana configurable

Para tareas de alto riesgo o desconocidas, mostrar el plan al usuario antes de ejecutar:

```
Orchestrator: "Plan generado:
  t1 → architect: analizar esquema actual
  t2 → data-analyst: evaluar volumen (depende de t1)
  t3 → writer: generar reporte (depende de t2)
  ¿Continuar? [s/n]"
```

Configurable por workflow: automático para tareas rutinarias, confirmación para tareas nuevas o destructivas.

### Flujo completo de defensas

```
LLM genera plan
      │
      ▼
┌──────────────────────────┐
│  Validación estructural  │ ← agentes válidos, IDs consistentes, sin ciclos
└───────────┬──────────────┘
            │ falla
            ▼
┌──────────────────────────┐
│  Retry con feedback      │ ← hasta 3 intentos con errores explícitos
└───────────┬──────────────┘
            │ sigue fallando
            ▼
┌──────────────────────────┐
│  Fallback a workflow     │ ← usa el flow estático si existe para este caso
│  estático                │
└───────────┬──────────────┘
            │ no hay workflow estático
            ▼
       Error al usuario

            │ plan válido
            ▼
┌──────────────────────────┐
│  Confirmación humana     │ ← solo para tareas de alto riesgo (configurable)
└───────────┬──────────────┘
            │
            ▼
    Publicar jobs en BullMQ
            │
            ▼
┌──────────────────────────┐
│  ComplianceGate          │ ← evaluador ≠ ejecutor en pasos críticos
└──────────────────────────┘
```

**Regla de oro: el LLM planifica, el sistema valida, los humanos aprueban lo irreversible.**

---

## Conectores MCP a sistemas de empresa (ERP, mensajería, correo)

Sin conectores, los agentes **saben** (vault + RAG) pero no **actúan** — sus únicas manos son `search_knowledge` y `write_knowledge`, y todo termina en un Markdown que un humano ejecuta. Los conectores cierran el loop:

```
SIN CONECTORES:
  agente analiza → escribe nota → humano ejecuta en el ERP

CON CONECTORES MCP:
  agente analiza → consulta el ERP → propone acción → gate → ejecuta en el ERP
                                                              │
                                                              └─► documenta en el vault
```

MCP es el estándar correcto: el framework ya habla MCP (el orchestrator es un MCP server, existe `bk-mcp-ai-vault`). Agregar conectores extiende un patrón existente.

### Encaje en la arquitectura: tools del ToolRegistry

Un conector MCP es un cliente que convierte las tools de un servidor MCP externo en tools del framework. La gobernanza ya diseñada aplica sin cambios:

```
┌──────────────────────────────────────────────┐
│              Worker (agente)                  │
│                                              │
│  ToolRegistry:                               │
│    search_knowledge   ← vault (ya existe)    │
│    write_knowledge    ← vault (ya existe)    │
│    erp_query_stock    ← MCP → ERP            │
│    erp_create_order   ← MCP → ERP    [GATE]  │
│    slack_send_message ← MCP → Slack  [GATE]  │
│    email_read_inbox   ← MCP → correo         │
└──────────────────────────────────────────────┘
```

- **Gate por defecto**: un conector de *escritura* (crear orden, enviar mensaje) es una acción con efectos → hereda gate obligatorio; solo una política lo libera
- **Privacy routing**: datos del ERP de nómina → LLM local, sin cambios al diseño
- **Scopes por agente** en `orchestrator.yaml`:

```yaml
agents:
  - id: finance-agent
    provider: local
    connectors:
      - erp: { tools: [query_stock, query_invoices], write: gated }
  - id: comms-agent
    provider: deepseek
    connectors:
      - slack: { tools: [send_message], write: gated }
      - email: { tools: [read_inbox] }      # solo lectura, sin gate
```

### Estrategia de adopción: lectura primero

| Fase | Conectores | Riesgo | Valor |
|---|---|---|---|
| **1. Solo lectura** | consultar ERP, leer mensajes, leer calendario | casi nulo | enorme — alimenta el vault con datos vivos |
| **2. Escritura gated** | crear borradores, proponer órdenes (humano aprueba) | bajo | el humano pasa de ejecutar a aprobar |
| **3. Escritura autónoma** | acciones liberadas por política | gestionado | la visión completa |

La fase 1 resuelve además el problema del **flywheel frío**: el vault deja de depender solo de notas humanas — los agentes consultan el ERP y generan conocimiento ("el stock de X baja 20% cada diciembre") que queda en el vault. Los conectores de lectura alimentan el moat.

### Riesgos específicos

1. **Tool sprawl rompe a los modelos locales**: un modelo de 7B con 30 tools degrada muchísimo su tool-use — elige mal, alucina argumentos. Mitigación: cada agente especialista recibe **solo sus tools** (5-8 máximo), nunca el catálogo completo. El orquestador enruta al especialista correcto; el especialista tiene pocas manos pero las usa bien.

2. **Madurez de los MCP servers para ERPs**: Slack, Gmail y calendarios tienen servers decentes; los ERPs regionales (Tango, Odoo, sistemas locales) probablemente no. Es un costo y una oportunidad: los conectores MCP a sistemas regionales pueden ser parte del producto (familia `bk-mcp-*`).

3. **Credenciales**: scopes mínimos por conector, secretos fuera de `orchestrator.yaml` (env vars / vault de secretos), y cada llamada de conector registrada en el audit trail con el agente que la hizo.

---

## n8n: manos y sentidos de la empresa autónoma

El enterprise ya tiene la semilla: `createN8nTriggerTool` (`integrations/n8nTriggerTool.ts`) — la tool `n8n_trigger` postea eventos a un webhook de n8n con correlation ID para tracing. Como BullMQ, está construida pero subutilizada.

### n8n y los conectores MCP no compiten — operan en capas distintas

| | Conector MCP | n8n |
|---|---|---|
| **Cuándo se usa** | Durante el *razonamiento* del agente | Después de la *decisión* del agente |
| **Naturaleza** | Interactivo — el agente decide llamar y usa el resultado para pensar | Determinístico — secuencia fija de pasos en múltiples sistemas |
| **Ejemplo** | "consultar stock de X" → el agente razona con el dato | "empleado aprobado" → crear usuario AD + email + Slack + ERP, en orden |
| **Latencia** | Baja, sincrónico en el loop del LLM | No importa, corre solo |

```
RAZONAMIENTO (necesita datos para pensar):
  agente → MCP connector → ERP query → respuesta → sigue razonando

EJECUCIÓN (la decisión ya está tomada):
  agente → [GATE] → n8n_trigger("employee.onboarded", payload)
                        │
                        └─► n8n: crea usuario AD → da de alta en ERP
                            → envía email de bienvenida → notifica a Slack
                            (con retries, credenciales y logs propios de n8n)
```

### Lo que n8n resuelve que es caro construir

1. **400+ integraciones ya hechas** — construir un MCP server para cada ERP regional es meses de trabajo; n8n probablemente ya tiene el nodo, o al menos HTTP genérico con manejo de auth. Para la fase de escritura, n8n es el shortcut.

2. **Credenciales** — el riesgo #3 de los conectores lo resuelve n8n de fábrica: las credenciales viven en n8n, encriptadas, con scopes. Los agentes nunca las ven; solo conocen un webhook URL.

3. **El humano ve y modifica las integraciones** — un workflow de n8n es visual. Si cambia el proceso de onboarding, operaciones edita el flujo en n8n sin tocar código del framework. Encaja con "humanos como gobernadores".

4. **Eventos de negocio que despiertan agentes** — la dirección inversa, y la más valiosa:

```
HOY: el sistema solo reacciona a pedidos de usuarios

CON N8N COMO SENSOR:
  llega factura al email → n8n la detecta → POST a orchestrator_run
  → workflow "procesar-factura" se ejecuta solo

  cliente escribe por WhatsApp → n8n → orquestador → agente de soporte responde
```

n8n se vuelve el **sistema sensorial** de la empresa autónoma: los agentes no esperan que alguien les hable — reaccionan a eventos del negocio. Es la pieza que habilita los niveles 3-4 de autonomía de verdad.

### Regla crítica: n8n es manos y sentidos, nunca cerebro

n8n tiene nodos de IA y permite LLM calls dentro de sus workflows. **No usarlos.** Si el razonamiento se reparte entre el framework y n8n:

- hay dos lugares donde se toman decisiones → los gates y políticas del framework no cubren lo decidido dentro de n8n
- el audit trail se parte en dos
- el vault deja de ser la memoria única

La división estricta:

```
Framework/agentes  → TODO el razonamiento, decisiones, gates, políticas
n8n                → ejecución determinística (manos) + detección de eventos (sentidos)
MCP connectors     → lecturas que el agente necesita mientras piensa
```

### El cuadro completo de integraciones

```
                    SENTIDOS                      CEREBRO                    MANOS
              ┌──────────────────┐         ┌──────────────────┐      ┌──────────────────┐
  email  ───► │                  │ webhook │   Orchestrator   │      │                  │ ──► ERP
  ERP evt ──► │   n8n triggers   │ ──────► │   + agentes      │ ───► │  n8n workflows   │ ──► email
  WhatsApp ─► │                  │         │   (framework)    │ gate │                  │ ──► Slack/AD
              └──────────────────┘         └───────┬──────────┘      └──────────────────┘
                                                   │    ▲
                                          lecturas │    │ contexto
                                          en vivo  ▼    │
                                           ┌────────────┴─────┐
                                           │  MCP connectors  │ ──► ERP (read-only)
                                           │  + vault RAG     │
                                           └──────────────────┘
```

### Fases de adopción

1. **Fase 1 (ya casi está)**: `n8n_trigger` existe; falta el camino inverso (n8n → `orchestrator_run` vía webhook), que con la ejecución durable (`runId`) es trivial — n8n dispara el run y consulta el estado con `orchestrator_status`
2. **Fase 2**: MCP connectors read-only para lecturas durante el razonamiento
3. **Fase 3**: escritura vía n8n workflows, siempre detrás de gate

---

## El vault como contrato de la empresa

En la visión de empresa autónoma, el vault no es solo memoria — es donde viven las políticas que gobiernan el comportamiento de los agentes:

```
vault/
  politicas/
    limites-aprobacion-autonoma.md   ← "pagos < $10k: autónomo"
    escalacion-rrhh.md               ← "despidos siempre requieren gate"
    sla-respuesta-incidentes.md      ← "resolver en < 2hs"
  agentes/                           ← lo que los agentes producen
  auditoria/                         ← vista legible del audit trail
  excepciones/                       ← casos donde el agente escaló al humano
```

**Sobre la inmutabilidad del audit trail**: archivos Markdown en disco no son inmutables — cualquier proceso con acceso al filesystem puede editarlos. Si la auditabilidad es el argumento central del sistema, el registro primario necesita garantía real: cada entrada de auditoría incluye el hash de la entrada anterior (hash chain), de modo que cualquier edición posterior rompe la cadena y es detectable. El vault es la **vista legible** de la auditoría; la cadena de hashes es la **garantía**. Alternativa más fuerte: audit primario en un store append-only (Redis Streams, tabla insert-only) con el vault como proyección.

### Políticas deterministas, conocimiento por RAG

Hay una distinción crítica en cómo los agentes acceden al vault. **RAG es retrieval probabilístico**: si la búsqueda no recupera la política de límites de pago (chunk mal cortado, score bajo el umbral, query mal formulada), para ese agente en esa decisión la política no existe. Una falla de retrieval se convierte en una falla de compliance.

Por eso los dos usos se separan:

| Tipo de contenido | Mecanismo de acceso | Garantía |
|---|---|---|
| Políticas (`/politicas/`) | **Carga determinística**: todas las políticas aplicables al tipo de acción se cargan completas, siempre | Ninguna decisión se toma sin las reglas presentes |
| Conocimiento (resto del vault) | RAG semántico: lo más relevante según la query | Best-effort, suficiente para contexto |

Las políticas llevan frontmatter estructurado que permite el matching determinístico:

```yaml
---
type: policy
applies_to: [payments, transfers]     # tipos de acción que cubre
agents: [finance-agent, payroll-agent] # o "all"
effect: require_gate | allow_autonomous
condition: "amount > 10000"            # evaluable, no interpretable
---
```

El policy engine carga por `applies_to` + `agents` (un filtro exacto, no una búsqueda semántica) e inyecta el set completo en el contexto del agente antes de actuar. El cuerpo Markdown de la política sigue siendo legible por humanos y por RAG — pero la decisión de escalación se basa en el frontmatter, nunca en lo que el retrieval haya tenido a bien recuperar.

## ComplianceGate como interfaz humano-máquina

En la visión autónoma, el gate deja de ser una herramienta de compliance y se convierte en **el único punto de contacto regular entre humanos y agentes**:

```
Cola de aprobaciones humanas:
  [ ] Aprobar nómina de junio — $450,000     (payroll-agent, nivel 2)
  [ ] Revisar desvinculación Juan P.          (hr-agent, nivel 2)
  [ ] Validar reporte regulatorio BCRA        (compliance-agent, nivel 1)
  [✓] Onboarding María G. completado          (autónomo nivel 3, solo auditar)
  [✓] Reporte semanal de ventas generado      (autónomo nivel 4, sin acción)
```

Humanos no ejecutan — aprueban o auditan.

## Lo que falta para llegar a la visión completa

Piezas pendientes, en orden de criticidad. Las marcadas con ✅ ya están construidas.

1. ✅ **Auth + RBAC** — JWT con `tools[]` embebidas, access_control.yaml con 5 capas, audit NDJSON
2. ✅ **Runtime SPI** — Docker adapter (disponible) + k8s adapter (disponible); deploy, stop, logs, exec, list
3. ✅ **Cloud-platform** — departments, deployables, catalog con `requiredSecrets`, workflows, API keys M2M
4. ✅ **Director como coordinador MCP** — conecta 10 agentes especialistas vía stdio, restart en caliente
5. **Gates por defecto en planes dinámicos** — la regla "toda acción con efectos hereda gate" no existe en el código; hoy un plan dinámico estructuralmente válido ejecuta sin frenos
6. **Policy engine determinístico** — el matching por `applies_to` + frontmatter estructurado; sin esto las políticas dependen del azar del retrieval
7. **Ejecución durable con `runId`** — `run_flow` debe retornar inmediato y el run vivir en Redis/BullMQ; sin esto los gates de aprobación humana que duran horas no pueden existir
8. **BullMQ workers reales** — hoy el flujo es sincrónico; se necesitan workers paralelos con retry
9. **Contexto de run por Redis** — eliminar la race condition del paso de resultados entre subtareas vía RAG
10. **Provenance y curación de notas de agentes** — defensa contra el envenenamiento del vault
11. **Hash chain en auditoría** — convertir "inmutable" de afirmación a garantía
12. **Verificación cruzada de resultados** — reemplaza al confidence scoring auto-reportado (mal calibrado por naturaleza)
13. **Dashboard de auditoría** — UI donde los humanos ven lo que pasó, aprueban lo pendiente y revisan excepciones
14. **Anomaly detection** — detectar cuando un agente toma decisiones fuera de su patrón histórico
15. **Enforcement de niveles de autonomía** — hoy el nivel por workflow es metadata; el executor debe hacerlo cumplir según el nivel configurado
16. **Conectores MCP a sistemas de empresa** — cliente MCP en el worker que monta tools externas en el ToolRegistry, con scopes por agente; arrancar con 2-3 conectores de solo-lectura (ERP del cliente piloto + mensajería)
17. **n8n como sensor de eventos** — el camino n8n → `run_flow` vía webhook, para que eventos de negocio (factura entrante, mensaje de cliente) disparen workflows sin intervención humana; depende de la ejecución durable

---

## Principios de diseño

1. **Vault como contrato de la empresa**: políticas, memoria y audit trail en un solo lugar legible
2. **Memoria duradera en el vault, estado efímero fuera de él**: la memoria institucional vive en el vault; la memoria de trabajo del agente (episódica, dentro del run) vive en el framework y en Redis, y muere con el run. Lo que merece sobrevivir se escribe explícitamente al vault.
3. **Autonomía calibrada por riesgo**: cada workflow tiene su nivel de autonomía según reversibilidad e impacto
4. **La autonomía se gana, no se asume**: toda acción con efectos tiene gate por defecto; solo una política explícita la libera
5. **Políticas deterministas, conocimiento por RAG**: las reglas se cargan completas y siempre; el contexto se recupera semánticamente
6. **LLM planifica, sistema valida**: el TaskPlanner es una propuesta, nunca tiene autoridad final
7. **Workflows estáticos como red de seguridad**: si el planner dinámico falla, el sistema cae al workflow conocido
8. **Privacy by routing**: datos sensibles → LLM local; razonamiento general → cloud
9. **Flywheel con curación**: cada ejecución enriquece el vault, pero las notas de agentes se ponderan por provenance hasta ser verificadas
10. **Humanos como gobernadores**: definen políticas, aprueban excepciones, auditan resultados — no ejecutan
11. **Lectura primero, escritura por etapas**: los conectores a sistemas de empresa arrancan en solo-lectura; la escritura llega gated y solo después autónoma por política
12. **Pocas tools por agente**: cada especialista recibe solo sus conectores (5-8 tools máximo) — el tool sprawl degrada a los modelos locales
13. **n8n es manos y sentidos, nunca cerebro**: todo el razonamiento vive en el framework; n8n ejecuta secuencias determinísticas y detecta eventos — sin LLM calls dentro de sus workflows
