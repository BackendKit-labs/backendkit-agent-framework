# Director Agent — Diseño de arquitectura

## Rol

El Director es la **inteligencia central y cara conversacional** del ecosistema BackendKit Platform. Es un **operador autónomo** — no un experto técnico. Sabe qué existe, cuándo usarlo, y cómo coordinarlo.

**El Director no ejecuta tareas técnicas directamente. Las delega al orquestador, que a su vez coordina agentes especialistas.**

## Arquitectura de tres capas

```
┌─────────────────────────────────────────────────────┐
│                    DIRECTOR                         │
│  "Qué hay que hacer y cuándo"                       │
│  Conversación con el usuario, decide qué flow       │
│  iniciar, aprueba gates, monitorea, deploya agentes │
│  Conocimiento: vault propio del ecosistema          │
└──────────────────────┬──────────────────────────────┘
                       │ start_flow / approve / status / deploy
┌──────────────────────▼──────────────────────────────┐
│                  ORQUESTADOR                        │
│  "Cómo ejecutarlo"                                  │
│  Descompone el objetivo en pasos, coordina          │
│  agentes especialistas, maneja orden y errores      │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
docker     k8s        coder     codex-context
agent      agent      (bk-agent)  agent
experto    experto    experto en  experto en
en Docker  en K8s     código      conocimiento
```

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

### Plano de operaciones (fleet — Stack B)
- `start_flow(flow_id, input)` — iniciar un flow declarativo conocido
- `list_runs` — monitorear ejecuciones en curso
- `orchestrator_approve(run_id)` — aprobar un gate
- `orchestrator_reject(run_id)` — rechazar un gate
- `list_agents` — ver qué agentes están deployados y su salud
- `get_config` — ver qué flows y agentes están configurados

### Plano de planificación (orchestrator — Stack A)
- `orchestrator_run(task, config_path)` — lanzar tarea compleja sin flow previo
- `orchestrator_status(run_id)` — monitorear
- `orchestrator_approve(run_id)` — aprobar gates

### Deploy de flota (via gateway HTTP)
- `POST /api/deploy` — deployar un nuevo agente como contenedor
- `DELETE /api/deploy/:id` — detener un agente

## Tools que el director NO necesita directamente

El orquestador llama a los especialistas — el director no:
- `docker-agent` tools → los usa el orquestador
- `k8s-agent` tools → ídem
- `bk-agent` (coder) tools → ídem
- `curator-agent` tools → ídem

## Flujo operacional típico

```
Usuario → Director
  1. Director busca en vault el flow correcto
  2. Director llama start_flow("onboarding-empleado", {nombre: "Juan", fecha: "2026-07-01"})
  3. Orquestador ejecuta pasos con agentes especialistas
  4. Orquestador alcanza gate → Director es notificado
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
| READMEs de agentes especializados | Sabe qué puede deployar y para qué sirve cada uno |

**No curar**: código fuente (`src/`), archivos de instalación, troubleshooting, `.env`, `package.json`.

## Configuración (director.yaml)

El director conecta solo al **fleet (Stack B)** y al **orquestador (Stack A)** como MCP servers — no a los agentes especialistas individuales.

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
| REPL terminal | ✅ disponible | `node dist/repl.js` — interacción directa |
| MCP stdio | ✅ disponible | Claude Desktop / Claude Code lo consumen como tool |
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
| codex conectado | ✅ |
| fleet (Stack B) conectado | ⬜ pendiente |
| orchestrator (Stack A) conectado | ⬜ pendiente |
| bk-agent --mcp | ⬜ pendiente |
| Vault curado | ⬜ pendiente |
| WebSocket :3500 | ⬜ pendiente |
| docker-compose.enterprise.yml | ⬜ pendiente |
