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
| `studio-agent` | ✅ | orchestrator-gateway HTTP :3400 | list_runs, start_flow, approve/reject/retry gate, list_agents, get_config, deploy_agent, stop_agent |
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

## Estado de implementación

| Componente | Estado |
|---|---|
| SOUL.md + director.yaml + tsconfig | ✅ |
| engine.ts (AgentEngine + MCPClientManager) | ✅ |
| provider.ts (OpenAI-compatible, configurable) | ✅ |
| repl.ts (REPL terminal) | ✅ |
| server.ts (MCP stdio: director_chat, director_clear, director_status) | ✅ |
| codex-context-agent-v2 conectado | ✅ |
| fleet (Stack B) conectado | ⬜ |
| orchestrator (Stack A) conectado | ⬜ |
| bk-agent --mcp (coder) | ⬜ |
| studio-agent (wrapper gateway :3400) | ✅ |
| vault-manager-agent (wrapper vault-manager :3000) | ✅ |
| Vault curado con conocimiento operacional | ⬜ |
| WebSocket :3500 | ⬜ |
| docker-compose.enterprise.yml | ⬜ |
