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

El ecosistema tiene dos orquestadores complementarios. El director los usa según el tipo de tarea:

| Plano | Agente | Cuándo lo usa el director |
|---|---|---|
| **Stack A — Planificación** | `orchestrator-agent` | Objetivos complejos sin flow previo. El LLM planea dinámicamente, tiene gates, reflection Cable 1+2, aprende. |
| **Stack B — Operaciones** | `orchestrator-mcp-agent` + `orchestrator-gateway` | Flows conocidos y declarativos. Deploy de agentes, gestión de flota, ejecución de templates. API limpia: `start_flow`, `deploy`, `list_agents`. |

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
| Vault curado con conocimiento operacional | ✅ 73 notas |
| MemorySystem 3-tier (episódica/semántica/procedural) | ⬜ |
| Auto-aprendizaje: ReflectionEngine + PatternDetector | ⬜ |
| Síntesis de skills vía synthesizer-agent | ⬜ |
| SkillManager integrado al engine | ⬜ |
| WebSocket :3500 | ⬜ |
| docker-compose.enterprise.yml | ⬜ |
