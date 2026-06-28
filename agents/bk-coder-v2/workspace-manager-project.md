
```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║                     ESQUEMA GLOBAL DEL ECOSISTEMA                                ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝

┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│                           DIRECTOR                                              │
│                (cara conversacional, RBAC, orquesta todo)                        │
│                                                                                 │
└─────────────────────────────┬──────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                  │
            ▼                 ▼                  ▼
┌────────────────────┐ ┌──────────────┐ ┌──────────────────┐
│                    │ │              │ │                  │
│   CODEX V2         │ │  FLEET       │ │  RUNS            │
│   (conocimiento)   │ │  (deploy)    │ │  (flujos)        │
│                    │ │              │ │                  │
└────────┬───────────┘ └──────────────┘ └──────────────────┘
         │
         │    ┌─────────────────────────────────────────────────────┐
         │    │                                                     │
         ├────┤            ORCHESTRATOR-AGENT V2                    │
         │    │  (Planifica flujos SDD, pool de procesos stdio)     │
         │    │                                                     │
         │    │  Para resolver una consulta pregunta a:             │
         │    │                                                     │
         │    │  ┌─────────────────────────────────────────────┐   │
         │    │  │                                             │   │
         │    │  │  WORKSPACE MANAGER PROJECT  ←─── search_knowledge │
         │    │  │  • projectRoot                               │   │
         │    │  │  • qué agentes tiene el proyecto             │   │
         │    │  │  • config de cada agente (model, tools...)   │   │
         │    │  │  • MEMORIA COMPARTIDA del proyecto           │   │
         │    │  │    (memoryNamespace)                         │   │
         │    │  │                                             │   │
         │    │  │  WORKSPACE MANAGER VAULT  ←── search_vault   │   │
         │    │  │  • vaults de conocimiento                    │   │
         │    │  │  • cambio de vault (workspace_switch)        │   │
         │    │  │  • cada agente tiene el suyo                 │   │
         │    │  │                                             │   │
         │    │  └─────────────────────────────────────────────┘   │
         │    │                                                     │
         │    │  Luego invoca al agente stdio correspondiente:      │
         │    │                                                     │
         │    │  ┌─────────────────────────────────────────────┐   │
         │    │  │                                             │   │
         │    │  │  DESIGN-MCP → genera specs, ADRs, roadmap   │   │
         │    │  │  BACKEND-MCP → escribe código               │   │
         │    │  │  QA-MCP      → valida contra specs         │   │
         │    │  │  SECURITY-MCP → revisa vulnerabilidades    │   │
         │    │  │  INFRA-MCP   → Docker, K8s, CI/CD          │   │
         │    │  │                                             │   │
         │    │  └─────────────────────────────────────────────┘   │
         │    │                                                     │
         └────┴─────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                          ~/.backendkit/                                     │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐               │
│  │              │  │              │  │                    │               │
│  │ projects.json│  │   vaults/    │  │   memories/        │               │
│  │              │  │              │  │                    │               │
│  │ LO CREA      │  │ agent-framework│  └─ project-name/   │               │
│  │ PROJECT MGR  │  │ backend/     │      ├── knowledge/   │               │
│  │              │  │ qa/          │      ├── patterns/    │               │
│  │ current: "x" │  │ security/    │      └── episodes/    │               │
│  │ projects: {} │  │ design/      │                    │               │
│  │              │  │ infra/       │  ┌─ otro-proyecto/  │               │
│  └──────────────┘  │              │  │                   │               │
│                    │ LO CREA      │  └───────────────────┘               │
│                    │ CADA AGENTE  │                                      │
│                    │ AL NACER     │  LO USA CODEX CON                    │
│                    └──────────────┘  memoryNamespace                     │
│                                       DEL PROJECT MANAGER                │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                               │
│  │ config/  │  │ notifier/│  │scheduler/│                               │
│  └──────────┘  └──────────┘  └──────────┘                               │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```


```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║                     FLUJOS DEL DIRECTOR EN EL ECOSISTEMA                             ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│                                DIRECTOR                                               │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                 │  │
│  │  ● Design conversacional (itera con humano → memoria → Design-MCP genera docs) │  │
│  │  ● Ejecutar flujos SDD (invoca Orchestrator → Coder v2)                        │  │
│  │  ● Desplegar (gestiona fleet, Docker/K8s)                                      │  │
│  │  ● Gestionar agentes (schedule, notification, config, health-checker)           │  │
│  │  ● RBAC (autenticación, roles, permisos, auditoría)                             │  │
│  │  ● Consultar conocimiento (search_vault, search_knowledge)                      │  │
│  │                                                                                 │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO 1: DISEÑO CONVERSACIONAL (el que nos compete ahora)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Humano: "Necesito un agente codificador mejor que bk-agent"
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│                        DIRECTOR + HUMANO ITERAN                                       │
│                                                                                       │
│  ┌──────────┐                      ┌──────────┐                                      │
│  │ HUMANO   │◄────────────────────►│ DIRECTOR │                                      │
│  │          │     propone,         │          │                                      │
│  │          │◄─── feedback ────►   │          │                                      │
│  │          │     refina,          │          │                                      │
│  │          │◄─── vuelve ─────►    │          │                                      │
│  │          │     itera...         │          │                                      │
│  └──────────┘                      └────┬─────┘                                      │
│                                          │                                            │
│   Mientras iteran, el Director guarda    │                                            │
│   TODO en MEMORIA:                       │                                            │
│                                          │                                            │
│   ┌──────────────────────────────────┐   │                                            │
│   │                                  │   │                                            │
│   │  MEMORIA SEMÁNTICA               │   │                                            │
│   │  (save_knowledge)                │   │                                            │
│   │                                  │   │                                            │
│   │  "Decisión: usar 2 Workspace     │   │                                            │
│   │   Managers, uno para vault y     │   │                                            │
│   │   otro para project"             │   │                                            │
│   │                                  │   │                                            │
│   │  "Decisión: vault es del agente  │   │                                            │
│   │   (fijo), memoria es del         │   │                                            │
│   │   proyecto (cambia al switchear)"│   │                                            │
│   │                                  │   │                                            │
│   ├──────────────────────────────────┤   │                                            │
│   │                                  │   │                                            │
│   │  MEMORIA PROCEDURAL              │   │                                            │
│   │  (learn_pattern)                 │   │                                            │
│   │                                  │   │                                            │
│   │  "trigger: resolver vault en     │   │                                            │
│   │   tiempo real → action: codex    │   │                                            │
│   │   consulta workspace managers    │   │                                            │
│   │   con TTL 30s → success"         │   │                                            │
│   │                                  │   │                                            │
│   ├──────────────────────────────────┤   │                                            │
│   │                                  │   │                                            │
│   │  MEMORIA EPISÓDICA               │   │                                            │
│   │  (remember)                      │   │                                            │
│   │                                  │   │                                            │
│   │  "Se descartó la opción de un    │   │                                            │
│   │   solo workspace manager por     │   │                                            │
│   │   problema de concurrencia"      │   │                                            │
│   │                                  │   │                                            │
│   └──────────────────────────────────┘   │                                            │
│                                          │                                            │
└──────────────────────────────────────────┼────────────────────────────────────────────┘
                                           │
              Cuando el humano dice "OK, así está bien"
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│              DIRECTOR INVOCA AL CODER V2 (Orchestrator)                               │
│                                                                                       │
│  "Coder v2, ejecutá SDD para 'coder-v2'.                                            │
│   Contexto en memoria, namespace 'coder-v2'.                                        │
│   Project root: C:/dev/coder-v2.                                                     │
│   Agents: design, backend, qa, security, infra"                                      │
│                                                                                       │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│              DESIGN-MCP (dentro del Coder v2)                                         │
│                                                                                       │
│  1. search_knowledge({namespace: "coder-v2"})                                        │
│     → Obtiene TODAS las decisiones de la iteración                                   │
│                                                                                       │
│  2. search_patterns({namespace: "coder-v2"})                                         │
│     → Obtiene los patrones acordados                                                 │
│                                                                                       │
│  3. recall({namespace: "coder-v2"})                                                  │
│     → Obtiene incidentes y descartes                                                │
│                                                                                       │
│  4. Con todo eso, genera:                                                           │
│     ┌────────────────────────────────────────────┐                                  │
│     │  .specs/                                   │                                  │
│     │  ├── specification.md    ← requisitos      │                                  │
│     │  ├── design.md           ← ADRs           │                                  │
│     │  └── ROADMAP.md          ← fases          │                                  │
│     └────────────────────────────────────────────┘                                  │
│                                                                                       │
│  5. save_knowledge({archivos generados})                                             │
│                                                                                       │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│              GATE HUMANO: ¿Aprueba los archivos?                                      │
│                                                                                       │
│  ┌──────────┐                    ┌──────────┐                                        │
│  │ HUMANO   │◄──────────────────►│ DIRECTOR │                                        │
│  │          │  revisa archivos   │          │                                        │
│  │          │                    │          │                                        │
│  │  "Falta  │   feedback         │          │                                        │
│  │   ADR X" │──────────────────► │          │                                        │
│  │          │                    │          │                                        │
│  │          │◄───────────────────│  DESIGN  │ → revise_spec() → regenera             │
│  │          │  corregido         │  -MCP    │                                        │
│  │          │                    │          │                                        │
│  │  "Dale"  │──────────────────► │          │  → CONTINUAR                           │
│  └──────────┘                    └──────────┘                                        │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO 2: EJECUTAR SDD (después del diseño aprobado)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Director: "Coder v2, ejecutá el flujo SDD completo"
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│              ORCHESTRATOR-AGENT V2                                                     │
│                                                                                       │
│  project_get_agent_config("backend") → { root, model, srcPath }                      │
│  project_get_agent_config("qa")      → { root, model, specPath }                     │
│  project_get_agent_config("security")→ { root, model }                                │
│                                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────────┐    │
│  │  FASE 1: BACKEND-MCP implementa por fase del ROADMAP                         │    │
│  │  FASE 2: QA-MCP valida cada fase (independiente)                             │    │
│  │  FASE 3: SECURITY-MCP revisa (automático por Cable 2)                        │    │
│  │  FASE 4: INFRA-MCP genera Docker, K8s, CI/CD                                 │    │
│  │  FASE 5: CURAR conocimiento + promover patrones                              │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO 3: DESPLEGAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Director: "Desplegá el servicio en staging"
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│              mcp__fleet__deploy_agent({                                                │
│                id: "auth-service",                                                    │
│                image: "registry/auth:latest",                                         │
│                instances: 2                                                           │
│              })                                                                       │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO 4: GESTIONAR AGENTES (Schedule, Notification, etc.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Director: "Programá un recordatorio para mañana a las 11"
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  Orchestrator → mcp__runs__start_flow({                                                │
│    flow_id: "schedule-task",                                                          │
│    input: { type: "one_time", when: "...", workflow: "send-reminder" }               │
│  })                                                                                   │
│    → Scheduler-agent agenda la tarea                                                  │
│    → Cuando se dispara, Notification-agent envía el recordatorio                      │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO 5: RBAC (Autenticación, Roles, Permisos)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usuario: "Ejecutá el flujo de deploy"
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  Director valida:                                                                     │
│  1. ¿Quién es el usuario? → JWT / API Key                                            │
│  2. ¿Qué rol tiene? → admin, dev, tech-lead, viewer                                  │
│  3. ¿Está autorizado para esta acción?                                               │
│     → "deploy" requiere rol admin o tech-lead                                        │
│  4. Si NO → "Acceso denegado. Se requiere rol admin o tech-lead."                    │
│     + audit log: { user, action, timestamp, status: "denied" }                       │
│  5. Si SÍ → ejecuta la acción                                                        │
│     + audit log: { user, action, timestamp, status: "approved" }                     │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESUMEN: EL DIRECTOR ES EL PUNTO ÚNICO DE ENTRADA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Todo pasa por el Director. No hay otro camino.

┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│                                    USUARIO                                            │
│                                                                                       │
└──────────────────────────────────┬───────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│                                DIRECTOR                                               │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────┐      │
│  │                                                                             │      │
│  │  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  ┌────────────┐ │      │
│  │  │ Diseño         │  │ Ejecutar SDD   │  │ Desplegar    │  │ Gestionar  │ │      │
│  │  │ (itera→memoria→│→│ (Orchestrator  │→│ (Fleet,      │→│ Agentes    │ │      │
│  │  │  Design-MCP)   │  │  → Coder v2)  │  │  Docker/K8s) │  │ (Schedule, │ │      │
│  │  └────────────────┘  └────────────────┘  └──────────────┘  │ Notif,     │ │      │
│  │                                                            │ Config...) │ │      │
│  │                                              ┌────────────┐└────────────┘ │      │
│  │                                              │ RBAC       │               │      │
│  │                                              │ (Roles,    │               │      │
│  │                                              │  Permisos, │               │      │
│  │                                              │  Auditoría)│               │      │
│  │                                              └────────────┘               │      │
│  └────────────────────────────────────────────────────────────────────────────┘      │
│                                                                                       │
│  Tools MCP del Director:                                                              │
│  mcp__codex__*       → vault y memoria                                                │
│  mcp__fleet__*       → deploy Docker/K8s                                             │
│  mcp__runs__*        → flujos y tareas                                               │
│  mcp__orchestrator__*→ planificación dinámica                                        │
│  mcp__coder__*       → tareas de código                                              │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Ahora sí, la especificación completa:

---

```
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║              WORKSPACE MANAGER PROJECT — ESPECIFICACIÓN FINAL v1.0      ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. QUÉ ES Y QUÉ NO ES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Servidor MCP stdio que administra los ESPACIOS DE TRABAJO DE PROYECTOS.

✅ RESPONSABILIDAD:
  - Administrar proyectos: nombre, projectRoot (dónde está el código)
  - Definir qué agentes participan en cada proyecto (backend, qa, security, design, infra)
  - Configurar cada agente (model, srcPath, tools, temperature, maxTokens)
  - Administrar MEMORIA COMPARTIDA del proyecto (memoryNamespace)
  - Administrar policies y gates del proyecto

❌ NO ES RESPONSABILIDAD:
  - Vaults de conocimiento → Workspace Manager Vault
  - Cambiar de vault → Workspace Manager Vault
  - Decir qué vault usa cada agente → Workspace Manager Vault
  - Curar conocimiento → Codex

RELACIÓN CON LOS OTROS SERVIDORES:
  Codex consulta a PROJECT MANAGER para resolver búsquedas en MEMORIA
  Codex consulta a VAULT MANAGER para resolver búsquedas en VAULT
  Son independientes. Cada uno hace lo suyo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. CÓMO RESUELVE EL CODEX CADA CONSULTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

search_vault({query, agentId: "backend"})
  → Codex consulta WORKSPACE MANAGER VAULT: workspace_current()
  → Obtiene el vault activo para ese agente
  → Busca allí
  → El PROJECT MANAGER no interviene

search_knowledge({query})
  → Codex consulta WORKSPACE MANAGER PROJECT: project_current()
  → Obtiene: memoryNamespace = "project-name"
  → Busca en: memories/project-name/knowledge/*
  → El VAULT MANAGER no interviene

recall({query})
  → Codex consulta WORKSPACE MANAGER PROJECT: project_current()
  → memoryNamespace = "project-name"
  → Busca en: memories/project-name/episodes/*

learn_pattern({trigger, action, outcome})
  → Codex consulta WORKSPACE MANAGER PROJECT: project_current()
  → memoryNamespace = "project-name"
  → Guarda en: memories/project-name/patterns/*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. ESTRUCTURA EN DISCO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

~/.backendkit/                          ← YA EXISTE (lo crea el framework)
│
├── projects.json                       ← LO CREA Y USA PROJECT MANAGER
│
├── vaults/                             ← LO USA VAULT MANAGER
│   ├── agent-framework/   ← vault del Director (ya existe, 710 notas)
│   ├── backend/           ← vault del Backend-MCP
│   ├── qa/                ← vault del QA-MCP
│   ├── security/          ← vault del Security-MCP
│   ├── design/            ← vault del Design-MCP
│   └── infra/             ← vault del Infra-MCP
│
├── memories/                           ← LO USA CODEX (namespace del Project)
│   └── {projectId}/
│       ├── knowledge/
│       ├── patterns/
│       └── episodes/
│
├── config/                ← config-agent
├── notifier/              ← notification-agent
└── scheduler/             ← schedule-agent

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. MODELO DE DATOS (projects.json)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "version": "1.0",
  "current": "project-name",
  "projects": {
    "project-name": {
      "name": "Project Name - Backend Core",
      "root": "C:/dev/project-name",
      "description": "API REST para e-commerce",
      "createdAt": "2026-06-20T00:00:00.000Z",
      "updatedAt": "2026-06-20T12:00:00.000Z",

      "agents": {
        "backend": {
          "model": "deepseek-v3",
          "temperature": 0.3,
          "maxTokens": 8000,
          "srcPath": "src",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command",
                    "search_vault", "read_note", "learn_pattern"]
        },
        "qa": {
          "model": "claude-sonnet",
          "temperature": 0.3,
          "maxTokens": 8000,
          "srcPath": "src",
          "specPath": ".specs",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command",
                    "search_vault", "search_knowledge", "learn_pattern",
                    "remember", "recall"]
        },
        "security": {
          "model": "gpt-4o",
          "temperature": 0.2,
          "maxTokens": 6000,
          "memoryNamespace": "project-name",
          "tools": ["read_file", "search_vault", "save_knowledge",
                    "learn_pattern", "remember", "recall"]
        },
        "design": {
          "model": "deepseek-r1",
          "temperature": 0.7,
          "maxTokens": 8000,
          "specPath": ".specs",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "search_vault",
                    "save_knowledge", "search_knowledge", "learn_pattern"]
        },
        "infra": {
          "model": "deepseek-v3",
          "temperature": 0.3,
          "maxTokens": 6000,
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command", "search_vault"]
        }
      },

      "policies": {
        "enabled": ["pr-auth-security-review", "pr-require-tests"]
      },

      "memory": {
        "namespace": "project-name",
        "enabled": true
      },

      "gates": {
        "designReview": "human",
        "securityReview": "auto",
        "qaApproval": "auto"
      }
    },

    "otro-proyecto": {
      "name": "Otro Proyecto - Mobile API",
      "root": "C:/dev/otro-proyecto",
      "agents": {
        "backend": {
          "model": "deepseek-v3",
          "srcPath": "api/src",
          "memoryNamespace": "otro-proyecto",
          "tools": ["read_file", "write_file", "execute_command",
                    "search_vault", "read_note", "learn_pattern"]
        },
        "qa": {
          "model": "claude-sonnet",
          "srcPath": "api/src",
          "specPath": ".specs",
          "memoryNamespace": "otro-proyecto",
          "tools": ["read_file", "write_file", "execute_command",
                    "search_vault", "search_knowledge", "learn_pattern",
                    "remember", "recall"]
        }
      },
      "policies": { "enabled": ["pr-require-tests"] },
      "memory": { "namespace": "otro-proyecto", "enabled": true },
      "gates": { "designReview": "disabled", "securityReview": "disabled",
                 "qaApproval": "auto" }
    }
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. TOOLS MCP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

────────────────────────────────────────────────────────────────────────
5.1 project_list()
────────────────────────────────────────────────────────────────────────
  Sin argumentos.

  Output: {
    current: "project-name" | null,
    projects: [
      { id: "project-name", name: "Project Name", root: "C:/dev/...", active: true }
    ]
  }

────────────────────────────────────────────────────────────────────────
5.2 project_current()
────────────────────────────────────────────────────────────────────────
  Sin argumentos.

  Output: {
    id: "project-name",
    name: "Project Name - Backend Core",
    root: "C:/dev/project-name",
    agents: { backend: {...}, qa: {...}, ... },
    policies: { enabled: [...] },
    memory: { namespace: "project-name", enabled: true },
    gates: { designReview: "human", securityReview: "auto", qaApproval: "auto" }
  }

  Error si no hay proyecto activo:
  { error: "No hay proyecto activo. Usá project_switch o project_create." }

────────────────────────────────────────────────────────────────────────
5.3 project_switch({ name })
────────────────────────────────────────────────────────────────────────
  Input: { name: "project-name" }

  Cambia el proyecto activo. Los agentes existentes automáticamente
  leen la nueva memoria porque el codex resuelve en tiempo real.

  Output: { success: true, previous: "x", current: "project-name" }
  Error: { success: false, error: "Proyecto no encontrado. Disponibles: ..." }

────────────────────────────────────────────────────────────────────────
5.4 project_create({ name, root, agents?, description?, policies?, gates? })
────────────────────────────────────────────────────────────────────────
  Input: {
    name: "project-name",
    root: "C:/dev/project-name",
    description?: "API REST",
    agents: {
      backend: { model: "deepseek-v3", srcPath: "src" }  ← al menos backend
    },
    policies?: { enabled: ["pr-require-tests"] },
    gates?: { designReview: "human", ... }
  }

  - memoryNamespace se genera automáticamente = name
  - Si no se especifican agentes, se usan defaults (ver sección 6)
  - Si no se especifican tools, se asignan las del default
  - Si no se especifica model, se asigna el del default

  Output: { success: true, project: { id, name, root, agents, ... } }
  Error: { success: false, error: "El campo 'name' es obligatorio." }
  Error: { success: false, error: "Ya existe un proyecto con nombre '...'." }

────────────────────────────────────────────────────────────────────────
5.5 project_delete({ name })
────────────────────────────────────────────────────────────────────────
  Input: { name: "project-name" }

  No permite eliminar el proyecto activo.

  Output: { success: true, deleted: "project-name" }
  Error: { success: false, error: "No se puede eliminar el proyecto activo.
          Usá project_switch primero." }

────────────────────────────────────────────────────────────────────────
5.6 project_get_agent_config({ agentId, projectId? }) ★
────────────────────────────────────────────────────────────────────────
  LA MÁS IMPORTANTE para el Codex.

  Input: {
    agentId: "backend" | "qa" | "security" | "design" | "infra",
    projectId?: "project-name"     ← opcional, usa current si no se especifica
  }

  Output: {
    root: "C:/dev/project-name",      ← projectRoot
    model: "deepseek-v3",
    temperature: 0.3,
    maxTokens: 8000,
    srcPath: "src",
    specPath?: ".specs",
    memoryNamespace: "project-name",  ← para memoria del proyecto
    tools: ["read_file", "write_file", "execute_command", "search_vault", ...]
  }

  → NO devuelve información de vaults. Eso es del Vault Manager.

  Error: { error: "No hay proyecto activo." }
  Error: { error: "Agente 'frontend' no configurado en este proyecto." }

────────────────────────────────────────────────────────────────────────
5.7 project_get_root({ projectId? })
────────────────────────────────────────────────────────────────────────
  Input: { projectId?: "project-name" }

  Output: { root: "C:/dev/project-name", name: "project-name" }

  Los agentes llaman a esto ANTES de escribir código para saber DÓNDE.

────────────────────────────────────────────────────────────────────────
5.8 project_duplicate({ name, newName, newRoot? })
────────────────────────────────────────────────────────────────────────
  Clona un proyecto como template para otro.
  Si no se especifica newRoot, usa el mismo root.

  Output: { success: true, project: { id, name, root, ... } }

────────────────────────────────────────────────────────────────────────
5.9 project_update({ name, updates })
────────────────────────────────────────────────────────────────────────
  Merge parcial. No reemplaza todo el proyecto.

  Input: {
    name: "project-name",
    updates: {
      "agents.backend.model": "gpt-4o",
      "gates.qaApproval": "human"
    }
  }

  Output: { success: true, changes: [
    "agents.backend.model: deepseek-v3 → gpt-4o",
    "gates.qaApproval: auto → human"
  ]}

────────────────────────────────────────────────────────────────────────
5.10 project_agent_exists({ agentId, projectId? })
────────────────────────────────────────────────────────────────────────
  Útil para que el Orchestrator sepa si puede invocar a un agente.

  Output: {
    exists: true,
    config: { model: "deepseek-v3", memoryNamespace: "project-name", tools: [...] }
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. DEFAULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si project_create no especifica un agente, se usa su default:

  backend: {
    model: "deepseek-v3", temperature: 0.3, maxTokens: 8000,
    srcPath: "src",
    tools: ["read_file", "write_file", "execute_command",
            "search_vault", "read_note", "learn_pattern"]
  }

  qa: {
    model: "claude-sonnet", temperature: 0.3, maxTokens: 8000,
    srcPath: "src", specPath: ".specs",
    tools: ["read_file", "write_file", "execute_command",
            "search_vault", "search_knowledge", "learn_pattern",
            "remember", "recall"]
  }

  security: {
    model: "gpt-4o", temperature: 0.2, maxTokens: 6000,
    tools: ["read_file", "search_vault", "save_knowledge",
            "learn_pattern", "remember", "recall"]
  }

  design: {
    model: "deepseek-r1", temperature: 0.7, maxTokens: 8000,
    specPath: ".specs",
    tools: ["read_file", "write_file", "search_vault",
            "save_knowledge", "search_knowledge", "learn_pattern"]
  }

  infra: {
    model: "deepseek-v3", temperature: 0.3, maxTokens: 6000,
    tools: ["read_file", "write_file", "execute_command", "search_vault"]
  }

  memoryNamespace = projectId (se genera automático)

POLICIES DEFAULT: ["pr-require-tests"]
GATES DEFAULT: { designReview: "human", securityReview: "auto", qaApproval: "auto" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. ESTRUCTURA DEL CÓDIGO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

workspace-manager-project/
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts              ← Entry point (AgentMCPServer + engine)
    ├── WorkspaceManager.ts    ← Clase principal con lógica CRUD
    ├── types.ts               ← Interfaces del modelo de datos
    ├── tools/
    │   ├── index.ts           ← Registro de tools
    │   ├── list.ts
    │   ├── current.ts
    │   ├── switch.ts
    │   ├── create.ts
    │   ├── delete.ts
    │   ├── getAgentConfig.ts  ★ herramienta principal
    │   ├── getRoot.ts
    │   ├── duplicate.ts
    │   ├── update.ts
    │   └── agentExists.ts
    └── storage/
        └── projectStore.ts    ← CRUD sobre projects.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. ENTRY POINT (server.ts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { createEngine } from './engine.js';
import { toolDefinitions } from './tools/index.js';

async function main() {
  const transport = new CallbackTransport();
  const engine = createEngine(transport);

  const server = new AgentMCPServer({
    name: 'workspace-manager-project',
    version: '1.0.0',
    tools: toolDefinitions,
    engine
  });

  server.startStdio();
}

main().catch(console.error);

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. VALIDACIONES Y ERRORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Si projects.json no existe → crearlo con estructura vacía
- Si el proyecto activo apunta a uno eliminado → limpiar current
- Si no hay proyecto activo → project_current, getAgentConfig, getRoot
  devuelven error con lista de proyectos disponibles
- Eliminar proyecto activo → error: "Usá project_switch primero"
- Crear proyecto con nombre existente → error
- Crear proyecto sin name → error
- Crear proyecto sin root → error
- Crear proyecto sin agents → error (al menos backend obligatorio)
- getAgentConfig sin proyecto activo y sin projectId → error
- getAgentConfig de agente inexistente en el proyecto → error
- project_switch al mismo proyecto → ok (idempotente)
- project_update con updates vacío → ok (sin cambios)
- Los root paths NO se validan (la verificación la hace el agente al escribir)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. package.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "name": "@backendkit-labs/workspace-manager-project",
  "version": "1.0.0",
  "description": "MCP server for managing project workspaces (projectRoot, agents, memory, policies, gates)",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "npx tsx src/server.ts",
    "test": "jest"
  },
  "dependencies": {
    "@backendkit-labs/mcp-server": "^1.0.0",
    "@backendkit-labs/agent-core": "^1.0.0",
    "dotenv": "^16.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/node": "^20.x",
    "jest": "^29.x"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. PRUEBAS MÍNIMAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Crear proyecto con todos los agentes default
2. Crear proyecto solo con backend (qa, security, design, infra opcionales)
3. Switch entre proyectos
4. project_current devuelve el proyecto activo correcto
5. project_get_agent_config("backend") devuelve config en proyecto activo
6. project_get_agent_config("qa", "otro-proyecto") con projectId explícito
7. project_get_root() devuelve el root del proyecto activo
8. project_get_agent_config sin proyecto activo → error
9. project_delete del proyecto activo → error
10. project_delete de proyecto inactivo → ok
11. project_duplicate clona correctamente
12. project_update mergea parcialmente
13. project_agent_exists devuelve true/false
14. Persistencia: crear proyecto, reiniciar servidor, debe seguir existiendo
15. project_get_agent_config devuelve memoryNamespace correcto

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
12. RESUMEN DE RESPONSABILIDADES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  WORKSPACE MANAGER PROJECT dice:                                     │
│  → projectRoot: "C:/dev/project-name"  (DÓNDE está el código)       │
│  → agents: backend, qa, security, design, infra                     │
│  → config: model, srcPath, tools por agente                         │
│  → memoryNamespace: "project-name"      (memoria COMPARTIDA)        │
│  → policies: reglas Cable 2 del proyecto                            │
│  → gates: designReview, securityReview, qaApproval                  │
│                                                                       │
│  WORKSPACE MANAGER VAULT dice:                                       │
│  → qué vaults existen                                                │
│  → workspace_switch para cambiar de vault                           │
│  → cada agente tiene su vault global                                 │
│                                                                       │
│  CODEX pregunta a cada uno lo suyo:                                  │
│  → search_vault() → VAULT MANAGER                                   │
│  → search_knowledge() → PROJECT MANAGER                             │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```