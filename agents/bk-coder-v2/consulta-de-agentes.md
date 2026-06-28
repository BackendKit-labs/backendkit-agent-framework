
```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║           FLUJO DE CONSULTAS: CÓMO LOS AGENTES SOLICITAN INFORMACIÓN                ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LO QUE CADA AGENTE NECESITA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  TODO agente stdio necesita 3 cosas:                                                 │
│                                                                                       │
│  1. PROJECT ROOT     → DÓNDE escribir/leer código                                    │
│                       → Lo pide a: Workspace Manager Project                         │
│                       → Consulta: project_get_root()                                 │
│                                                                                       │
│  2. VAULT EXPERTISE  → CÓMO hacer su trabajo (conocimiento del agente)              │
│                       → Lo pide a: Workspace Manager Vault                           │
│                       → Consulta: workspace_current()                                │
│                       → El vault es FIJO, global, no cambia al switchear             │
│                                                                                       │
│  3. MEMORY CONTEXT   → QUÉ se decidió en este proyecto (compartido)                 │
│                       → Lo pide a: Workspace Manager Project                         │
│                       → Consulta: project_get_agent_config(agentId) → memoryNamespace│
│                       → La memoria CAMBIA al switchear de proyecto                   │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO COMPLETO: BACKEND-MCP RECIBE UNA TAREA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Orchestrator invoca a Backend-MCP:
  "Implementá el módulo JWT con refresh token (Fase 2 del ROADMAP)"

┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────────┐   │
│  │                    BACKEND-MCP                                                │   │
│  │                                                                               │   │
│  │  PASO 1: ¿DÓNDE escribo el código?                                           │   │
│  │                                                                               │   │
│  │    ──► project_get_root()                                                  │   │
│  │        ──► Workspace Manager Project                                         │   │
│  │        ◄── { root: "C:/dev/project-name", name: "project-name" }            │   │
│  │                                                                               │   │
│  │    → "Ahora sé que debo escribir en C:/dev/project-name/src/"               │   │
│  │                                                                               │   │
│  │  ─────────────────────────────────────────────────────────────────────────   │   │
│  │                                                                               │   │
│  │  PASO 2: ¿CÓMO implemento JWT? (necesito mi expertise)                      │   │
│  │                                                                               │   │
│  │    ──► search_vault({ query: "cómo implementar JWT refresh en NestJS" })     │   │
│  │        │                                                                      │   │
│  │        ──► Codex recibe la consulta                                           │   │
│  │            │                                                                  │   │
│  │            ──► Codex pregunta al VAULT MANAGER:                               │   │
│  │                ──► workspace_current() (¿qué vault está activo?)             │   │
│  │                ◄── { name: "backend", vaultPath: "vaults/backend" }          │   │
│  │            │                                                                  │   │
│  │            ──► Codex busca en vaults/backend/*                                │   │
│  │            ◄── notas relevantes: "JWT con RS256", "refresh rotation"         │   │
│  │        │                                                                      │   │
│  │    ◄── resultados: ["JWT con RS256 en NestJS", "refresh rotation patterns"]   │   │
│  │                                                                               │   │
│  │    → "Ahora sé CÓMO implementarlo"                                           │   │
│  │                                                                               │   │
│  │  ─────────────────────────────────────────────────────────────────────────   │   │
│  │                                                                               │   │
│  │  PASO 3: ¿QUÉ decisiones se tomaron en este proyecto? (contexto compartido) │   │
│  │                                                                               │   │
│  │    ──► search_knowledge({ query: "algoritmo de firma JWT" })               │   │
│  │        │                                                                      │   │
│  │        ──► Codex recibe la consulta                                           │   │
│  │            │                                                                  │   │
│  │            ──► Codex pregunta al PROJECT MANAGER:                             │   │
│  │                ──► project_current() (¿qué proyecto está activo?)            │   │
│  │                ◄── { id: "project-name", memory: { namespace: "project-name" }}│
│  │            │                                                                  │   │
│  │            ──► Codex busca en memories/project-name/knowledge/*               │   │
│  │            ◄── "Se acordó usar RS256 para JWT en este proyecto"              │   │
│  │        │                                                                      │   │
│  │    ◄── "Se acordó usar RS256, blacklist en Redis"                            │   │
│  │                                                                               │   │
│  │    → "Ahora sé QUÉ decidió el equipo"                                        │   │
│  │                                                                               │   │
│  │  ─────────────────────────────────────────────────────────────────────────   │   │
│  │                                                                               │   │
│  │  PASO 4: ¿Hubo errores previos relacionados?                               │   │
│  │                                                                               │   │
│  │    ──► recall({ query: "refresh token problemas" })                        │   │
│  │        │                                                                      │   │
│  │        ──► Codex: project_current() → memoryNamespace: "project-name"       │   │
│  │        ──► Codex busca en memories/project-name/episodes/*                  │   │
│  │        ◄── "El QA encontró refresh token a 30d en vez de 7d"               │   │
│  │    ◄── "Error previo: TTL incorrecto en refresh token"                       │   │
│  │                                                                               │   │
│  │    → "Ahora sé qué evitar"                                                   │   │
│  │                                                                               │   │
│  │  ─────────────────────────────────────────────────────────────────────────   │   │
│  │                                                                               │   │
│  │  PASO 5: Implementa con toda la información                                   │   │
│  │                                                                               │   │
│  │    write_file({ path: "C:/dev/project-name/src/auth/jwt.service.ts",         │   │
│  │                 content: "..." })                                              │   │
│  │                                                                               │   │
│  │  ─────────────────────────────────────────────────────────────────────────   │   │
│  │                                                                               │   │
│  │  PASO 6: Guarda aprendizaje                                                 │   │
│  │                                                                               │   │
│  │    learn_pattern({                                                            │   │
│  │      trigger: "refresh rotation",                                             │   │
│  │      action: "usar family + blacklist",                                       │   │
│  │      outcome: "success",                                                      │   │
│  │      namespace: "project-name"    ← del PROJECT MANAGER                      │   │
│  │    })                                                                         │   │
│  │                                                                               │   │
│  │    save_knowledge({                                                           │   │
│  │      content: "JWT refresh implementado con rotation family + blacklist",     │   │
│  │      tags: ["jwt", "refresh", "implementado"],                                │   │
│  │      namespace: "project-name"                                                │   │
│  │    })                                                                         │   │
│  │                                                                               │   │
│  └──────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIAGRAMA DE FLUJO: LAS 3 CONSULTAS DEL AGENTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────┐     ┌───────────────────┐     ┌──────────────────────┐
│              │     │                   │     │                      │
│ BACKEND-MCP  │     │   CODEX V2        │     │  WORKSPACE MANAGERS  │
│              │     │                   │     │                      │
└──────┬───────┘     └────────┬──────────┘     └──────────┬───────────┘
       │                     │                           │
       │  ① project_get_root │                           │
       │─────────────────────►                           │
       │                     │                           │
       │                     │  project_current?         │
       │                     │──────────────────────────►│  PROJECT
       │                     │◄──────────────────────────│  { root, name }
       │                     │                           │
       │◄────────────────────│                           │
       │  { root: "C:/..." } │                           │
       │                     │                           │
       │──────────────────────────────────────────────────────────────────
       │                     │                           │
       │  ② search_vault(   │                           │
       │     "JWT NestJS")   │                           │
       │─────────────────────►                           │
       │                     │                           │
       │                     │  workspace_current?       │
       │                     │──────────────────────────►│  VAULT
       │                     │◄──────────────────────────│  { vaultPath }
       │                     │                           │
       │                     │  busca en vaults/backend  │
       │◄────────────────────│                           │
       │  notas de backend   │                           │
       │                     │                           │
       │──────────────────────────────────────────────────────────────────
       │                     │                           │
       │  ③ search_knowledge│                           │
       │     ("algoritmo")   │                           │
       │─────────────────────►                           │
       │                     │                           │
       │                     │  project_current?         │
       │                     │──────────────────────────►│  PROJECT
       │                     │◄──────────────────────────│  { memoryNamespace }
       │                     │                           │
       │                     │  busca en memories/project│
       │◄────────────────────│                           │
       │  "RS256 acordado"   │                           │
       │                     │                           │
       ▼                     ▼                           ▼
  Implementa código    Codez resuelve cada       Cada manager responde
  con toda la info     consulta al manager        lo suyo

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESUMEN: QUÉ CONSULTA CADA AGENTE Y A QUIÉN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌────────────┬────────────────────────────────┬──────────────────────┬──────────────────┐
│   AGENTE   │         NECESITA SABER          │    CONSULTA A        │     PARA QUÉ     │
├────────────┼────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ DÓNDE escribir código           │ project_get_root()   │ projectRoot      │
│  BACKEND   ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ CÓMO (expertise)                │ search_vault()       │ vaults/backend/*  │
│            ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ QUÉ (contexto del proyecto)     │ search_knowledge()   │ project-mem/*     │
├────────────┼────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ DÓNDE está la spec              │ project_get_root()   │ specPath         │
│    QA      ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ CÓMO (expertise en testing)     │ search_vault()       │ vaults/qa/*       │
│            ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ QUÉ (decisiones del proyecto)   │ search_knowledge()   │ project-mem/*     │
│            ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ Incidentes previos              │ recall()             │ project-mem/*     │
├────────────┼────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ CÓMO (expertise en seguridad)   │ search_vault()       │ vaults/security/* │
│  SECURITY  ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ Decisiones del proyecto         │ search_knowledge()   │ project-mem/*     │
│            ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ Incidentes previos              │ recall()             │ project-mem/*     │
├────────────┼────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ DÓNDE dejar los specs           │ project_get_root()   │ specPath          │
│   DESIGN   ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ CÓMO (expertise en diseño)      │ search_vault()       │ vaults/design/*   │
│            ├────────────────────────────────┼──────────────────────┼──────────────────┤
│            │ Decisiones previas              │ search_knowledge()   │ project-mem/*     │
└────────────┴────────────────────────────────┴──────────────────────┴──────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTAS CLAVE DESDE LA PERSPECTIVA DEL AGENTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🧠 EL AGENTE NO SABE:
     - En qué proyecto está trabajando (solo recibe tareas del Orchestrator)
     - Qué otros agentes existen
     - Cómo funciona el Workspace Manager
     - Qué modelos usan los demás

  🧠 EL AGENTE SABE:
     - Su agentId ("backend", "qa", "security", "design", "infra")
     - Las tools que tiene disponibles (read_file, write_file, search_vault, ...)
     - Cómo hacer su trabajo (su vault de expertise)

  🧠 EL AGENTE PIDE:
     - project_get_root() → para saber DÓNDE escribir
     - search_vault({query}) → codex resuelve su vault automáticamente
     - search_knowledge({query}) → codex resuelve la memoria del proyecto
     - recall({query}) → codex resuelve la memoria del proyecto

  🧠 EL CODEX RESUELVE:
     - search_vault → pregunta a VAULT MANAGER: "¿qué vault está activo?"
     - search_knowledge → pregunta a PROJECT MANAGER: "¿qué proyecto está activo?"
     - El agente nunca sabe a qué servidor se consulta. Solo pide y recibe.

  🧠 AL SWITCHEAR DE PROYECTO:
     - search_vault → SIGUE dando el mismo resultado (el vault no cambia)
     - search_knowledge → CAMBIA (ahora responde con la memoria del nuevo proyecto)
     - project_get_root() → CAMBIA (ahora devuelve el nuevo root)
     - El agente NO necesita reiniciarse. Sigue funcionando igual.
```