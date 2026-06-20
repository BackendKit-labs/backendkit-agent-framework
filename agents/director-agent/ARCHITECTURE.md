# Director Agent — Diseño de arquitectura

## Rol

El Director es la **inteligencia central y cara conversacional** del ecosistema BackendKit Platform. Es un **operador autónomo** — no un experto técnico. Sabe qué existe, cuándo usarlo, y cómo coordinarlo.

**El Director no ejecuta tareas técnicas directamente. Las delega al orquestador, que a su vez coordina agentes especialistas.**

## Arquitectura de tres capas

```
┌─────────────────────────────────────────────────────────────────┐
│                          DIRECTOR                               │
│  "Qué hay que hacer y cuándo"                                   │
│  Conversación con el usuario, decide qué flow iniciar,          │
│  aprueba gates, monitorea, deploya agentes al ecosistema        │
│  Conocimiento: vault propio del ecosistema                      │
└─────────────────────────────┬───────────────────────────────────┘
                              │ start_flow / approve / status / deploy
┌─────────────────────────────▼───────────────────────────────────┐
│                        ORQUESTADOR                              │
│  "Cómo ejecutarlo"                                              │
│  Descompone el objetivo en pasos, coordina agentes              │
│  especialistas, maneja orden, gates y errores                   │
└──┬────────┬────────┬────────┬────────┬────────┬─────────────────┘
   │        │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼        ▼
docker    k8s     coder   codex-  studio  vault-mgr  ... otros
agent     agent   (bk-    context  agent   agent      especialistas
                  agent)  agent     ↕        ↕
                                  agent-  vault-
                                  studio  manager
                                  (:3001)  (:3000)
```

### Catálogo de agentes especialistas

| Agente | Estado | Wrappea | Capacidades |
|---|---|---|---|
| `docker-agent` | ✅ | Docker daemon | containers, compose, swarm, volumes, registry, build |
| `k8s-agent` | ✅ | Kubernetes API | apply manifests, inspect resources, logs, exec |
| `bk-agent` (coder) | ⬜ `--mcp` pendiente | `apps/bk-agent` | spec-driven dev, 10 especialistas coding, QA, git |
| `codex-context-agent-v2` | ✅ | vault RAG local | curate_path, curate_link, search_vault, read_note |
| `curator-agent` | ✅ | vault Obsidian | ingesta masiva de documentos enterprise con LLM |
| `curator-codex-agent` | ✅ | vault + HTTP API | análisis código + RAG + seguridad, HTTP Protocol v1 |
| `workspace-manager` | ✅ | workspaces multi-proyecto | gestión de vaults y proyectos |
| `fleet-agent` | ✅ | orchestrator-gateway HTTP :3400 | deploy_agent, stop_agent, list_deployments, deploy_settings, fleet_health (solo deploy — orquestación va directo a orchestrator-mcp-agent) |
| `vault-manager-agent` | ✅ | `vault-manager` HTTP :3000 | list_vaults, search_knowledge, list_notes, ingest_text (cola de auditoría humana), sync_vault |
| `orchestrator-gateway` | ✅ | `orchestrator-mcp-agent` | bridge HTTP↔MCP para agent-studio (:3400) |
| `run-recovery-daemon` | ✅ | orchestrator runs | recupera runs colgados, health de agentes |
| `synthesizer-agent` | ✅ | planner + writer | síntesis de skills desde runs exitosos |

## Dos planos de orquestación

El ecosistema tiene dos orquestadores con **responsabilidades distintas** — no son variantes del mismo concepto:

| Plano | Agente | Rol | Modo |
|---|---|---|---|
| **Stack A** | `orchestrator-agent` | **Operador autónomo de plataforma** — infra, scheduling, reportes, automatización. El Hermes del ecosistema. | PROACTIVO — corre por su cuenta |
| **Stack B** | `orchestrator-mcp-agent` + gateway | **Motor de flujos de negocio** — ejecuta flows declarativos conocidos (ventas, onboarding, soporte). | REACTIVO — lo dispara el director o un webhook |

### Stack B — Motor de flujos de negocio

Conoce el **"qué"** — procesos de negocio definidos. Ejecuta flows declarativos con agentes HTTP (Agent Protocol v1). API limpia: `start_flow`, `list_runs`, `approve`, `get_config`.

```
Iniciado por:  Director / webhook externo
Duración:      Finita (run completo)
Agentes:       HTTP Protocol v1
Aprende:       No (flows estáticos)
```

### Stack A — Operador autónomo de plataforma (el Hermes del ecosistema)

Conoce el **"cómo"** — cómo desplegar, conectar, automatizar, monitorear. Es
**proactivo**: corre por su cuenta, iniciado por cron/eventos, con duración
potencialmente perpetua. Equivale a Hermes aplicado a la infraestructura.

```
Iniciado por:  Cron / evento / trigger externo / director
Duración:      Permanente / recurrente / perpetua
Agentes:       MCP stdio/HTTP especializados
Aprende:       Sí — reflection Cable 1+2, RAG vault
```

**Capacidades tipo Hermes:**

```
Scheduling y automatización:
  "Generá el reporte de ventas todos los viernes a las 18:00"
  "Revisá cada hora si hay containers caídos y reinicialos"
  "Hacé backup del vault todos los domingos"
  "Cuando llegue un commit, corré el pipeline"

Reportes automáticos:
  "Reporte diario de infraestructura → Slack"
  "Reporte semanal de runs → email"
  "Alerta si k8s CPU > 80%"

Flows perpetuos:
  "Monitoreá el cluster en producción — siempre activo"
  "Escuchá el webhook de GitHub — procesá cada PR"
  "Mantené el vault sincronizado con Confluence"

Infraestructura bajo demanda:
  "Deployá 3 réplicas del agente de ventas en Kubernetes"
  "Conectá el CRM de Salesforce como agente MCP"
  "Creá el workflow N8N para el trigger de HubSpot"
```

**Agentes MCP de Stack A:**

```
orchestrator-agent (Stack A)
  ├── docker-agent        ✅  contenedores, imágenes, compose, swarm
  ├── k8s-agent           ✅  namespaces, deployments, scaling
  ├── codex-v2            ✅  consultar/actualizar vault
  ├── scheduler-mcp       ⬜  cron + one-shot + eventos (flows perpetuos)
  ├── notification-mcp    ⬜  Slack, email, Telegram, webhook
  ├── n8n-mcp             ⚠️  BASE existe: createN8nTriggerTool() en packages/enterprise
  │                          (dispara webhook). Falta: CRUD workflows, estado ejecuciones
  └── external-mcp        ⬜  conectores a APIs externas vía MCP client
```

`scheduler-mcp` + `notification-mcp` son el corazón — scheduling y delivery de
resultados. Todo lo demás se construye sobre eso.

### Comparativa Director vs Stack A vs Stack B

| | Director | Stack A | Stack B |
|---|---|---|---|
| **Modo** | Reactivo | Proactivo | Reactivo |
| **Iniciado por** | Usuario habla | Cron / evento | Director / webhook |
| **Duración** | Una conversación | Permanente/recurrente | Finita (run completo) |
| **Contexto** | Conversación + vault | Vault + memoria propia | Plan + estado del run |
| **Salida** | Respuesta al usuario | Reporte / acción / alerta | Resultado del flow |
| **Aprende** | MemorySystem 3-tier | Reflection Cable 1+2 | No |

## Comparativa: orchestrator-agent vs bk-agent (multi-agente)

Ambos coordinan múltiples agentes pero con modelos de ejecución opuestos.

### Modelo de ejecución

| | **orchestrator-agent (Stack A)** | **bk-agent** |
|---|---|---|
| Dónde corren los agentes | **Procesos separados** — cada agente es un MCP server independiente (stdio o HTTP) | **Un solo proceso Node.js** — todos los agentes son perfiles dentro del mismo engine |
| Comunicación | MCP protocol (stdio) o HTTP Agent Protocol v1 | `ask_agent` tool → `DelegationBus` → cambio de perfil interno |
| Planificación | LLM genera plan JSON (`subtasks[]` con `depends_on`) **antes** de ejecutar | LLM decide en tiempo real a quién delegar con `ask_agent` |
| Paralelismo | Explícito — subtareas sin `depends_on` en común corren simultáneamente (BullMQ) | Implícito — múltiples `ask_agent` en la misma respuesta corren en paralelo (DelegationBus, max 6) |
| Escala | Multi-máquina — Redis/BullMQ distribuye subtareas a workers | Single-machine — un proceso |
| Modo de respuesta | **Asíncrono** — devuelve `runId`, el resultado llega después | **Síncrono** — el usuario ve el streaming en tiempo real |

### Dominio y especialización

| | **orchestrator-agent** | **bk-agent** |
|---|---|---|
| Dominio | Cualquiera — lo definen los agentes registrados | Código — 10 especialistas fijos (backend, security, QA, frontend, etc.) |
| Agentes | Externos, independientes, cualquier lenguaje/runtime | Perfiles YAML/JSON en el mismo proceso |
| Tools | Cada agente tiene sus propias tools | Todos comparten el mismo toolset (read_file, write_file, execute_command, ripgrep) |
| Añadir agente | Registrar un MCP server en `orchestrator.yaml` | Crear `{id}.json` + `{id}.md` en `~/.bk-agent/agents/` |

### Control y aprendizaje

| | **orchestrator-agent** | **bk-agent** |
|---|---|---|
| Gates | Explícitos en el plan (`gate: true`) — pausa y espera aprobación humana | QA reviewer inline — evalúa la respuesta automáticamente, no pausa el flujo |
| Reflection | Cable 1+2 — registra incidentes en vault, detecta patrones de fallo, promueve policy rules que fuerzan gates | ReflectionEngine — detecta patrones de error por dominio, promueve políticas por proyecto |
| Memoria | Episódica cross-run (inyecta outputs exitosos de runs anteriores al contexto del agente) | Per-project (sesion-actual.md, contexto-proyecto.md, history.json, patterns.json) |

### Cuándo usa el director cada uno

```
Tarea multi-sistema, multi-dominio, varios procesos:
  "Deployá el nuevo servicio de auth, revisá seguridad, cargá docs al vault"
  → orchestrator-agent: planifica dinámicamente, delega a docker-agent +
    security-agent + codex, gates en pasos críticos

Tarea de código, flujo conversacional, un dominio:
  "Implementá el módulo JWT según nuestra spec, con tests y code review"
  → bk-agent: general → backend + security + QA, streaming en tiempo real
```

### La combinación ideal — árbol completo del ecosistema

bk-agent puede funcionar de dos formas en el ecosistema:
1. Como **agente conversacional directo** — el usuario le habla desde el director
2. Como **especialista de código** dentro de un pipeline del orchestrator-agent

```
Director
  │
  ├── codex          (9t, stdio MCP)   ← conocimiento y vault RAG
  ├── fleet          (5t, stdio MCP)   ← deploy Docker/K8s via gateway HTTP
  │     └── orchestrator-gateway :3400
  │
  ├── coder [⬜]     (stdio MCP)       ← bk-agent --mcp: tarea de código,
  │     └── bk-agent                    proceso único, streaming en tiempo real
  │           ├── backend-agent         (interno, mismo proceso)
  │           ├── security-agent        (interno)
  │           ├── qa-engineer           (interno)
  │           └── ... (10 especialistas)
  │
  ├── runs           (stdio MCP)       ← Stack B: flows conocidos, config, gates
  │     └── orchestrator-mcp-agent
  │           ├── curator-codex-agent  (HTTP :3200, Agent Protocol v1)
  │           ├── synthesizer-agent    (HTTP)
  │           ├── triage-agent         (HTTP)
  │           └── formatter-agent      (HTTP)
  │
  └── orchestrator [⬜] (stdio MCP)   ← Stack A: planificación dinámica LLM,
        └── orchestrator-agent           gates, reflection Cable 1+2
              ├── docker-agent         (stdio MCP)
              ├── k8s-agent            (stdio MCP)
              ├── bk-agent             (stdio MCP — también especialista aquí)
              ├── codex-v2             (stdio MCP)
              └── curator-codex-agent  (HTTP)

[⬜] = pendiente de conectar
```

**Nota:** `bk-agent` aparece en dos lugares:
- Como `coder` directo en el director — para tareas conversacionales de código
- Como especialista de `orchestrator-agent` — cuando el orchestrator lo necesita en un pipeline

## Tools que el director necesita directamente

### Plano de conocimiento (codex)
- `search_vault` — buscar contexto antes de actuar
- `curate_path` / `curate_link` — incorporar nuevo conocimiento al vault
- `vault_status` — estado del vault

### Plano de operaciones — Stack B (fleet)
- `start_flow(flow_id, input)` — iniciar un flow declarativo conocido
- `list_runs` — monitorear ejecuciones en curso
- `orchestrator_approve(run_id)` — aprobar un gate
- `orchestrator_reject(run_id)` — rechazar un gate
- `list_agents` — ver qué agentes están deployados y su salud
- `get_config` — ver qué flows y agentes están configurados
- `POST /api/deploy` — deployar un nuevo agente como contenedor

### Plano de planificación — Stack A (orchestrator)
- `orchestrator_run(task, config_path)` — lanzar tarea compleja sin flow previo
- `orchestrator_status(run_id)` — monitorear
- `orchestrator_approve(run_id)` — aprobar gates

## Tools que el director NO necesita directamente

El orquestador llama a los especialistas — el director no:
- `docker-agent`, `k8s-agent`, `bk-agent`, `curator-agent` → los usa el orquestador
- `studio-agent`, `vault-manager-agent` → también los usa el orquestador (dentro de flows)

## Flujo operacional típico

```
Usuario → Director
  1. Director busca en vault el flow correcto (search_vault)
  2. Director llama start_flow("onboarding-empleado", {nombre: "Juan"})
  3. Orquestador ejecuta pasos:
       → vault-manager-agent: envía contrato a cola de auditoría humana
       → bk-agent: genera scripts de onboarding técnico
       → studio-agent: registra el nuevo agente en el pool
  4. Orquestador alcanza gate → Director notificado
  5. Director presenta gate al usuario con contexto
  6. Usuario aprueba → Director llama approve(run_id)
  7. Orquestador continúa y completa
  8. Director reporta resultado al usuario
```

## Vault del director — qué debe saber

El vault contiene **conocimiento operacional del ecosistema**, no código fuente.

| Qué curar | Para qué |
|---|---|
| `flows/templates/*/flows/*.yaml` | Saber qué flows existen y puede iniciar por nombre |
| `flows/templates/*/orchestrator.yaml` | Cómo están configurados los agentes de cada flow |
| `orchestrator-agent/docs/` | Entiende gates, reflection, cuándo usar orquestación dinámica |
| `codex-context-agent-v2/docs/` | Sabe qué puede hacer con el vault de conocimiento |
| `director-agent/SOUL.md` + `director.yaml` | Se conoce a sí mismo y al ecosistema |
| READMEs de cada agente especialista | Sabe qué puede deployar y para qué sirve cada uno |

**No curar**: código fuente (`src/`), archivos de instalación, `.env`, `package.json`, `test-*.mjs`.

## Infraestructura de vaults — BK_HOME

### Decisión de diseño (acordada)

**`vault-manager` es el registro central de todos los vaults del sistema.** Define dónde vive cada vault, quién puede acceder, y qué rol tiene. Todos los componentes deben conocer las rutas de vault a través de vault-manager (vía `vault-manager-agent` MCP) o derivándolas de la convención `$BK_HOME`.

**`~/.bk-agent/` es el `BK_HOME`** — el directorio de infraestructura del ecosistema. Ya existe y contiene: agents, projects (memoria+audits), rag indexes, skills, plugins, config, workspaces. No se crea un `~/.backendkit/` paralelo para no romper instalaciones existentes.

### Estructura unificada

```
~/.bk-agent/               ← BK_HOME (env var BK_HOME, default ~/.bk-agent/)
├── vaults/                ← TODAS las notas curadas de todos los vaults
│   ├── {project-name}/    ← vault por proyecto (codex-context-agent v2)
│   ├── enterprise/        ← vault empresarial compartido
│   └── shared/            ← conocimiento compartido entre proyectos
│
├── rag/                   ← TODOS los índices RAG (ya existe con 5 vaults indexados)
│   └── {vault-name}.json
│
├── data/                  ← state de runtime de cada componente
│   ├── orchestrator/      ← runs, config.db (orchestrator-agent)
│   ├── orchestrator-mcp/  ← runs.db, config.db (orchestrator-mcp-agent)
│   └── vault-manager/     ← vault.db SQLite (vault-manager app)
│
├── director/              ← memoria del director
│   ├── goals.json
│   └── user-model.json
│
├── agents/                ← perfiles custom de agentes (ya existe)
├── skills/                ← skills custom (ya existe)
├── projects/              ← memoria por proyecto de bk-agent (ya existe)
├── config.json            ← config de providers/MCP (ya existe)
└── workspaces.json        ← workspaces multi-proyecto (ya existe)
```

### Implementación — `@backendkit-labs/infra` (packages/infra)

Paquete SDK publicable que centraliza toda la lógica de paths y la inicialización del directorio de infraestructura. **Todos los componentes del ecosistema deben usar este paquete** en lugar de construir paths manualmente.

```typescript
import { getBkHome, bkPaths, initBkHome } from '@backendkit-labs/infra';

// En el arranque de cualquier agente:
await initBkHome();  // crea ~/.backendkit/ si no existe — idempotente

// Paths tipados:
bkPaths.vault('mi-proyecto')      // ~/.backendkit/vaults/mi-proyecto/
bkPaths.ragIndex('mi-proyecto')   // ~/.backendkit/rag/mi-proyecto.json
bkPaths.data('orchestrator')      // ~/.backendkit/data/orchestrator/
bkPaths.directorMemory()          // ~/.backendkit/director/
bkPaths.directorGoals()           // ~/.backendkit/director/goals.json
```

**`initBkHome()` crea en el primer arranque:**
```
~/.backendkit/
├── vaults/shared/
├── rag/
├── data/orchestrator/
├── data/orchestrator-mcp/
├── data/vault-manager/
├── director/
│   ├── goals.json        ← seed: []
│   └── user-model.json   ← seed: {}
└── README.md
```

**Componentes ya integrados:** `codex-context-agent-v2`, `director-agent`.
**Pendiente integrar:** `orchestrator-agent`, `orchestrator-mcp-agent`, `vault-manager`.

### Notas importantes

**`~/.backendkit/` lo crea el platform en el primer arranque** (vía `initBkHome()` de `@backendkit-labs/infra`). No depende de que bk-agent haya corrido antes. Cualquier componente que llame `initBkHome()` al arrancar garantiza que el directorio existe.

**`~/.bk-agent/` lo crea bk-agent en su primer inicio.** Es el home de bk-agent (agents, skills, projects, sessions, plugins). Se mantendrá separado hasta que bk-agent migre a `BK_HOME`. En esa migración, el contenido relevante se moverá a `~/.backendkit/` y bk-agent pasará a usar `BK_HOME`. Implicaciones actuales:
- Si bk-agent no fue iniciado, `~/.bk-agent/` no existe — pero `~/.backendkit/` sí existirá si cualquier componente del platform ya corrió.
- Los dos directorios coexisten hasta que bk-agent migre.

**El nombre `~/.backendkit/` está decidido.** Reemplaza `~/.bk-agent/` como home del platform. El env var `BK_HOME` permite override (ej. `/var/backendkit` en servidores). La migración de bk-agent para usar `BK_HOME` queda pendiente.

### Regla de paths para cada componente

| Componente | Path actual | Path unificado |
|---|---|---|
| codex-context-agent-v2 (notas) | `~/.codex-vaults/{project}/` | `$BK_HOME/vaults/{project}/` |
| codex-context-agent-v2 (RAG) | `~/.codex-context/rag/{project}.json` | `$BK_HOME/rag/{project}.json` |
| orchestrator-agent (data) | `.orchestrator/` local | `$BK_HOME/data/orchestrator/` |
| orchestrator-mcp-agent (data) | local junto al yaml | `$BK_HOME/data/orchestrator-mcp/` |
| vault-manager (SQLite) | `data/vault.db` relativo | `$BK_HOME/data/vault-manager/vault.db` |
| director-agent (memoria) | TBD | `$BK_HOME/director/` |
| knowledge-agent (RAG) | `~/.bk-agent/rag/` | `$BK_HOME/rag/` ✅ ya correcto |
| bk-agent (projects) | `~/.bk-agent/projects/` | `$BK_HOME/projects/` ✅ ya correcto |

### Migración codex v1 → v2

codex-context-agent v1 estaba integrado con bk-agent y generó vaults bajo su configuración propia. La migración es:
1. Mover notas v1 (`~/.codex-vaults/{name}/`) → `$BK_HOME/vaults/{name}/` vía `clone_vault`
2. Registrar cada vault en vault-manager (path, label, ownerRole)
3. Actualizar bk-agent config para usar codex v2 en vez de v1
4. Los índices RAG de `~/.bk-agent/rag/` ya están en el lugar correcto — no se mueven

### Cambio en codex-context-agent-v2 (✅ implementado)

Usa `@backendkit-labs/infra` — paths migrados a `~/.backendkit/`:
```typescript
// src/project.ts
await initBkHome();
const vaultPath = bkPaths.vault(projectName);   // ~/.backendkit/vaults/{project}/

// src/knowledge/rag-provider.ts
return bkPaths.ragIndex(path.basename(vaultPath)); // ~/.backendkit/rag/{name}.json
```

## Configuración (director.yaml)

El director conecta al **fleet (Stack B)**, al **orquestador (Stack A)** y a **codex** — no a los especialistas individuales.

```yaml
director:
  provider: deepseek          # configurable: deepseek | openai | ollama | claude
  ws_port: 3500               # WebSocket para front-ends de chat

agents:
  - name: codex               # Conocimiento propio del director
  - name: fleet               # Stack B: operaciones, flows conocidos, deploy
  - name: orchestrator        # Stack A: tareas complejas sin flow previo
  # coder (bk-agent --mcp): pendiente
```

## Front-doors (cómo se le habla al director)

| Interfaz | Estado | Descripción |
|---|---|---|
| REPL terminal | ✅ | `node dist/repl.js` — interacción directa |
| MCP stdio | ✅ | Claude Desktop / Claude Code lo consumen como tool |
| WebSocket :3500 | ⬜ pendiente | Chat web / director-desktop |
| Gateway (Telegram/Slack) | ⬜ futuro | Presencia multi-plataforma |

## Mejoras pendientes — aprendizaje y memoria

### MemorySystem 3-tier (del framework, no implementado en el director)

El framework ya tiene `MemorySystem` en `@backendkit-labs/agent-core` con tres capas. El director actualmente solo persiste `goals.json` y `user-model.json` como archivos planos — no usa las tres capas del framework.

```
Episódica  → qué pasó: flows iniciados, gates aprobados, decisiones tomadas, outcomes
Semántica  → quién es el usuario, qué le importa, contexto de su organización, preferencias
Procedural → patrones aprendidos: qué flows resuelven qué tipos de requests, routing óptimo
```

**Paths bajo BK_HOME:**
```
~/.backendkit/memory/episodic.json    ← log de acciones cross-session
~/.backendkit/memory/semantic.json    ← perfil del usuario y org
~/.backendkit/memory/procedural.json  ← patrones y flows que funcionan
```

**Implementación:** agregar `MemorySystem` a `buildDirectorEngine()` en `engine.ts`.
Los tools de memoria se inyectan al engine y el LLM los usa automáticamente para
recordar contexto de sesiones anteriores sin que el usuario lo pida.

### Auto-aprendizaje y síntesis de skills

bk-agent tiene esto implementado (`ReflectionEngine`, `PatternDetector`, `PolicyPromoter`).
El director debería tener su propio loop de aprendizaje sobre el routing y los flows:

```
Director inicia flow → orquestador ejecuta → outcome registrado en memoria episódica
     ↓
PatternDetector detecta patrón repetible (mismo tipo de request → mismo flow exitoso)
     ↓
synthesizer-agent genera nuevo static flow YAML (ya existe en agents/)
     ↓
Flow guardado en orchestrator config store (vía vault-manager-agent o runs.save_flow)
     ↓
Próxima vez: director encuentra el flow directo en el vault, sin planificación dinámica
```

**Diferencia con el orquestador:** el orquestador aprende sobre *ejecución* (gates, fallos de pasos).
El director aprende sobre *routing* (qué intención lleva a qué flow, qué usuarios prefieren qué).
Son capas complementarias — el orquestador ya tiene reflection Cable 1+2, el director agrega
la capa de aprendizaje orientada al usuario.

### La cadena completa de aprendizaje (diseño objetivo)

```
Usuario → Director
  │  MemorySystem: recuerda al usuario, sus patrones, flows que le funcionaron
  ↓
Orquestador
  │  Reflection Cable 1+2: aprende de gates y fallos de ejecución
  ↓
Especialistas (docker, k8s, coder, codex...)
  │  Ejecutan y devuelven resultado
  ↓
Director recibe outcome → actualiza memoria episódica → detecta patrones
  → synthesizer-agent sintetiza skill → nuevo static flow disponible
```

### SkillManager

El framework tiene `SkillManager` en `@backendkit-labs/agent-core`. El director debería
cargar skills desde `~/.backendkit/skills/` (cuando ese directorio exista) para inyectar
capacidades procedurales adicionales al engine según el contexto detectado.

### Relación con el vault RAG

El vault (codex-v2) es la **memoria semántica de dominio** — conocimiento curado del ecosistema.
La `MemorySystem` del framework es la **memoria operacional** — historial de acciones y patrones
aprendidos en tiempo real. Son complementarios, no redundantes:

| | Vault RAG (codex-v2) | MemorySystem |
|---|---|---|
| Qué guarda | Conocimiento del dominio (docs, flows, arquitectura) | Historial operacional (acciones, outcomes, patrones) |
| Cómo se puebla | `curate_path` / `curate_link` (explícito) | Automáticamente en cada run |
| Búsqueda | Semántica vectorial | Por tiempo, tag, similitud textual |
| Lifetime | Permanente, versionado | Acumulativo, puede purgarse |

## Seguridad — control de acceso (roles y permisos)

En una infraestructura de agentes para empresa, **el que controla la consola NO
controla todo**. El sistema distingue quién pide algo y si tiene derecho. Diseño
completo en [`ACCESS-CONTROL.md`](./ACCESS-CONTROL.md).

### Implementado: Capa 1 y Capa 2

Las dos primeras capas están activas en el director. Viven en `src/auth/`.

**Capa 1 — Identidad (JWT):** `director_chat` acepta `user_token?: string`.
Si `JWT_SECRET` está seteado en `.env`, el token es requerido y verificado (HS256).
Sin token + `JWT_SECRET` → rechaza. Sin `JWT_SECRET` → modo dev (admin implícito).

```
Usuario → director_chat({ message, user_token: "eyJ..." })
  → verifyToken() → Principal { id: "maria", role: "hr", department: "people" }
  → requestContext.run({ principal })   ← viaja por toda la cadena async
    → engine.run(message)
```

**Capa 2 — RBAC (`access_control` en `director.yaml`):** cada MCP tool se
envuelve en `guardTool()` al construir el engine. El wrapper lee el `Principal`
del `AsyncLocalStorage` antes de ejecutar. El LLM no puede saltear el check —
ocurre dentro del `execute()`, después de que el LLM ya eligió la tool.

```
LLM elige mcp__codex__reset_vault
  → guardTool intercepta
  → PolicyEngine.authorize({ role: "hr" }, "reset_vault") → false
  → devuelve "Autorización denegada: el rol hr no puede ejecutar reset_vault.
              Roles permitidos: admin."  ← el LLM lo recibe como tool result
```

Activar en producción: `enforce: true` en `director.yaml` + `JWT_SECRET` en `.env`.

### Principios (no negociables)

- **El LLM no es una frontera de seguridad.** El director hace routing blando; la
  frontera dura es código determinístico debajo, que el LLM no puede saltear.
- **On-behalf-of:** el director actúa con los permisos reducidos del usuario,
  nunca con los suyos (evita el "confused deputy").
- **La REPL es modo dev/admin.** El acceso enterprise va por front-door
  autenticado (web/WS con login). El REPL cae a `ADMIN_PRINCIPAL` porque no
  pasa por `server.ts`.

### Pendiente (arquitectura completa)

- `packages/identity`: extraer `src/auth/` a paquete compartido por todos los agentes.
- `apps/auth-service`: emisor central de JWTs (AuthN). Hoy `JWT_SECRET` es compartido; en
  producción un servicio firma y el director solo verifica con la clave pública.
- Enforcement role-aware en el orquestador: gates que exigen capability específica
  (quien inicia ≠ quien aprueba — separación de funciones).
- ABAC avanzado: condiciones cruzadas entre campos (`arg.solicitante != user.id`).

## Estado de implementación

| Componente | Estado |
|---|---|
| SOUL.md + director.yaml + tsconfig | ✅ |
| engine.ts (AgentEngine + MCPClientManager) | ✅ |
| provider.ts (OpenAI-compatible, configurable) | ✅ |
| repl.ts (REPL terminal) | ✅ |
| server.ts (MCP stdio: director_chat, director_clear, director_status) | ✅ |
| codex-context-agent-v2 conectado | ✅ |
| runs (orchestrator-mcp-agent MCP directo) en director.yaml | ✅ |
| fleet (fleet-agent → gateway :3400) en director.yaml | ✅ |
| bk-agent --mcp (coder) | ⬜ |
| studio-agent (wrapper gateway :3400) | ✅ |
| vault-manager-agent (wrapper vault-manager :3000) | ✅ |
| Vault curado con conocimiento operacional | ✅ 83 notas |
| MemorySystem 3-tier (episódica/semántica/procedural) integrado en engine.ts | ✅ |
| **Capa 1 — Identidad JWT** (`src/auth/jwt.ts`, `src/auth/context.ts`) | ✅ |
| **Capa 2 — RBAC** (`src/auth/policy.ts`, `access_control` en director.yaml) | ✅ |
| **Capa 3 — ABAC** (`src/auth/abac.ts`, `conditions` en director.yaml) | ✅ |
| **Capa 4 — Vault filter** (`src/auth/vault-filter.ts`, `vault_visibility` en director.yaml) | ✅ |
| **Capa 5 — Auditoría NDJSON** (`src/auth/audit.ts`, `~/.backendkit/audit/director-access.ndjson`) | ✅ |
| **config-agent** (gestión centralizada de config + secretos) | ✅ conectado + RBAC |
| **schedule-agent** (scheduling one-time + cron → ejecuta flows) | ✅ conectado + RBAC |
| **health-checker** (monitoreo del ecosistema completo) | ✅ conectado + RBAC |
| **notification-agent** (notificaciones multi-canal: email, Slack, Telegram, push) | ✅ conectado + RBAC |
| **coder** (bk-coder-v2/orchestrator — SDD: backend, QA, security, infra) | ✅ conectado + RBAC |
| Auto-aprendizaje: ReflectionEngine + PatternDetector | ⬜ |
| Síntesis de skills vía synthesizer-agent | ⬜ |
| SkillManager integrado al engine | ⬜ |
| n8n-mcp (CRUD workflows + ejecuciones) | ⚠️ base existe en packages/enterprise (`createN8nTriggerTool` — dispara webhook). Extender con CRUD y consulta de ejecuciones via N8N REST API |
| external-mcp (conectores APIs externas) | ⬜ |
| packages/identity (extraer src/auth/ como paquete compartido) | ⬜ |
| apps/auth-service (AuthN central: login + JWT firmado con clave pública) | ⬜ |
| Enforcement role-aware en orquestador (gates con capability) | ⬜ |
| WebSocket :3500 | ⬜ |
| docker-compose.enterprise.yml | ⬜ |
