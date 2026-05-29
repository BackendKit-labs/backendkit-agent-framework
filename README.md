# agent-framework

Framework multi-agente para asistentes de codigo, construido en TypeScript con arquitectura monorepo. Disenado para ser agnostico de LLM, agnostico de transporte y extensible mediante un sistema jerarquico de skills.

---

## Tabla de contenidos

1. [Vision general](#vision-general)
2. [Arquitectura](#arquitectura)
3. [Instalacion](#instalacion)
4. [Quickstart — REPL interactivo](#quickstart--repl-interactivo)
5. [Packages](#packages)
6. [Motor de agentes — @bk/agent-coding](#motor-de-agentes--bkagent-coding)
   - [Proveedores LLM](#proveedores-llm)
   - [Los 10 agentes especializados](#los-10-agentes-especializados)
   - [Prompts con modos de madurez](#prompts-con-modos-de-madurez)
   - [Orquestacion y delegacion paralela](#orquestacion-y-delegacion-paralela)
   - [Deteccion automatica de stack](#deteccion-automatica-de-stack)
   - [Herramientas de filesystem](#herramientas-de-filesystem)
   - [Herramientas de memoria y contexto](#herramientas-de-memoria-y-contexto)
   - [ProjectStore — persistencia entre sesiones](#projectstore--persistencia-entre-sesiones)
   - [AgentLoader — carga automatica de agentes](#agentloader--carga-automatica-de-agentes)
7. [Estructura de datos en disco](#estructura-de-datos-en-disco)
8. [Comando /init — inicializacion de proyectos](#comando-init--inicializacion-de-proyectos)
9. [Slash commands built-in](#slash-commands-built-in)
   - [/help](#help)
   - [/agents](#agents)
   - [/skills](#skills)
   - [/status](#status)
   - [/checkpoint](#checkpoint)
   - [/workspace](#workspace)
10. [Sistema de checkpoints](#sistema-de-checkpoints)
11. [Workspaces multi-proyecto](#workspaces-multi-proyecto)
12. [Sistema de Skills](#sistema-de-skills)
13. [Skills builtin](#skills-builtin)
14. [Servidor MCP](#servidor-mcp)
15. [Casos de uso basicos](#casos-de-uso-basicos)
16. [Casos de uso intermedios](#casos-de-uso-intermedios)
17. [Casos de uso avanzados](#casos-de-uso-avanzados)
18. [Crear agentes personalizados](#crear-agentes-personalizados)
19. [Instalar packs externos de skills](#instalar-packs-externos-de-skills)
20. [Crear tu propio pack de skills](#crear-tu-propio-pack-de-skills)
21. [Integracion con Claude Code / Cursor](#integracion-con-claude-code--cursor)
22. [Librerias de resiliencia](#librerias-de-resiliencia)
23. [Integrar los slash commands en tu app](#integrar-los-slash-commands-en-tu-app)
24. [Roadmap](#roadmap)

---

## Vision general

**agent-framework** resuelve tres problemas concretos al construir asistentes de codigo con LLMs:

| Problema | Solucion |
|----------|----------|
| Un solo agente no puede hacer todo bien | **9 agentes especializados** orquestados por un agente general |
| Los agentes olvidan convenciones del proyecto | **Skills + ProjectStore + session.md**: contexto persistente entre sesiones |
| Las llamadas a LLMs fallan o son lentas | **Resiliencia integrada**: CircuitBreaker, Retry, Bulkhead |

El framework no impone un LLM especifico. Funciona con DeepSeek, Anthropic (Claude), OpenAI, Kimi (Moonshot) o Grok.

---

## Arquitectura

```
agent-framework/
├── packages/
│   ├── core/          @bk/agent-core     — Motor generico, skills, orquestacion, commands, checkpoints, workspaces
│   ├── coding/        @bk/agent-coding   — 9 agentes, filesystem tools, LLM providers, /init, ProjectStore
│   └── mcp-server/    @bk/mcp-server     — Servidor MCP: code intelligence + skills
└── examples/
    └── coding-assistant/                 — REPL interactivo completo
```

### Diagrama de capas

```
┌─────────────────────────────────────────────────────────────┐
│              Tu app / CLI (ej: coding-assistant)            │
│         CallbackTransport  ·  Slash Commands  ·  REPL       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   @bk/agent-coding                          │
│                                                             │
│  createCodingEngine()  ·  9 Agent Profiles                  │
│  InitWorkflow (/init)  ·  AgentLoader                       │
│  Filesystem Tools      ·  Memory Tools                      │
│  LLM Providers: DeepSeek · OpenAI · Anthropic · Kimi · Grok │
│  ProjectStore  ·  ConfigLoader  ·  PersistentMemory         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    @bk/agent-core                           │
│                                                             │
│   AgentEngine  ←→  DelegationBus  ←→  AgentRegistry        │
│   ToolRegistry  ·  ProviderRegistry  ·  SessionMemory       │
│   Orchestrator  ·  FSM  ·  ContextPipeline                  │
│   QAService  ·  Reflection  ·  SkillSystem                  │
│   SlashCommandRegistry  ·  Checkpoint  ·  Workspace         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   @bk/mcp-server                            │
│  stack_detect  ·  code_search  ·  code_context              │
│  skills_search  ·  skills_install  ·  skills_list           │
│  Tree-sitter (6 lenguajes)  ·  SQLite FTS5  ·  chokidar    │
└─────────────────────────────────────────────────────────────┘
```

---

## Instalacion

### Requisitos

- Node.js >= 20
- npm >= 9

### Clonar y construir

```bash
git clone https://github.com/BackendKit-labs/backendkit-agent-framework.git
cd agent-framework
npm install
npm run build
```

### Usar como dependencia

```bash
npm install @bk/agent-core @bk/agent-coding
```

---

## Quickstart — REPL interactivo

El ejemplo `coding-assistant` incluye un REPL completo listo para usar.

### Configuracion inicial

```bash
# La primera vez se crea automaticamente ~/.bk-agent/config.json
node examples/coding-assistant/dist/index.js
```

Editar `~/.bk-agent/config.json` con tus API keys:

```json
{
  "providers": {
    "deepseek": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai":    { "apiKey": "sk-..." }
  },
  "defaultProvider": "anthropic"
}
```

O usar variables de entorno:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DEEPSEEK_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
```

### Iniciar el asistente

```bash
cd tu-proyecto
node /path/to/coding-assistant/dist/index.js
```

El agente arranca en modo `general` (orquestador). Desde ahi podes:

```
> /help               # Lista comandos + el LLM explica como puede ayudarte
> /init               # Analizar el proyecto y generar documentacion
> /agent list         # Ver todos los agentes disponibles
> /agent backend      # Cambiar al agente backend
> /checkpoint auth    # Guardar checkpoint de la sesion actual
> /workspace list     # Ver workspaces multi-proyecto
> Como agrego autenticacion JWT a la API?
```

---

## Packages

### `@bk/agent-core`

Motor generico del framework. Model-agnostic, transport-agnostic. Exporta el engine, sistema de skills, orquestacion, checkpoints, workspaces, comandos slash y utilidades compartidas.

### `@bk/agent-coding`

Capa especifica para asistentes de codigo. Incluye los 9 perfiles de agente, herramientas de filesystem, providers de LLM, ProjectStore y el InitWorkflow.

```typescript
import { createCodingEngine, createCodingEngineFromConfig } from '@bk/agent-coding';
```

### `@bk/mcp-server`

Servidor MCP que expone las capacidades del framework a Claude Code, Cursor, Windsurf y cualquier cliente compatible con el protocolo MCP.

---

## Motor de agentes — @bk/agent-coding

### Crear el engine

```typescript
import { createCodingEngine } from '@bk/agent-coding';
import { CallbackTransport } from '@bk/agent-core';

const engine = createCodingEngine({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY },
  },
  defaultProvider: 'anthropic',
  defaultAgent: 'general',       // Agente inicial
  workingDir: process.cwd(),
  maxIterations: 100,
  maxParallelAgents: 6,
  appName: 'mi-app',             // Define ~/.mi-app/ para persistencia
  transport: new CallbackTransport(event => console.log(event)),
});

await engine.run('Agrega autenticacion JWT a la API');
```

### Desde configuracion global

```typescript
import { createCodingEngineFromConfig } from '@bk/agent-coding';

// Lee ~/.bk-agent/config.json + env vars
const engine = createCodingEngineFromConfig({
  workingDir: process.cwd(),
  appName: 'mi-app',
});
```

---

### Proveedores LLM

El framework soporta 5 proveedores de LLM. Se pueden usar varios simultaneamente — cada agente puede tener su propio provider.

| Provider | Env var | Modelo default |
|----------|---------|----------------|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `kimi` | `KIMI_API_KEY` | `moonshot-v1-8k` |
| `grok` | `GROK_API_KEY` | `grok-3` |

```typescript
const engine = createCodingEngine({
  providers: {
    anthropic: { apiKey: '...', model: 'claude-opus-4-7' },
    deepseek:  { apiKey: '...', model: 'deepseek-coder' },
  },
  defaultProvider: 'anthropic',
});
```

---

### Los 10 agentes especializados

El framework incluye 10 agentes con roles bien definidos. El agente **general** actua como orquestador y nunca escribe codigo directamente — delega a los especialistas.

| Agente | Rol | Delega a |
|--------|-----|----------|
| `general` | Orquestador — analiza, divide y coordina en paralelo | todos los especialistas |
| `project-manager` | Coordinador del workflow de `/init` — produce design.md, specification.md, security.md, roadmap.md y AGENT.md | `architecture`, `backend`, `security`, `qa-engineer`, `coder` |
| `coder` | Implementador puro — escribe y edita archivos | — |
| `backend` | APIs REST/GraphQL, seleccion de arquitectura MVC/Clean/Hexagonal | `coder` |
| `frontend` | Componentes UI, Core Web Vitals, WCAG 2.1 AA | `coder` |
| `qa-engineer` | Auditoria holistica — implementaciones y propuestas, GO/NO-GO | `coder` |
| `security` | OWASP, JWT, OAuth, RBAC, hardening, GO/NO-GO | `coder` |
| `architecture` | DDD, microservicios, ADRs, diagramas C4, trade-offs | `coder`, `backend`, `frontend` |
| `infrastructure` | Docker, Kubernetes, CI/CD, cloud, Terraform, GO/NO-GO | `coder` |
| `data` | SQL, indexes, ETL, schema design, ML Engineering | `coder` |

---

### Prompts con modos de madurez

Todos los agentes especializados adaptan su nivel de exigencia al modo de madurez del proyecto:

| Modo | Cuando aplica | Que exige |
|------|---------------|-----------|
| **Prototype** | MVP, prueba de concepto | Arquitectura minima, sin ADRs, deuda tecnica controlada |
| **Beta** | Producto en desarrollo activo | Tests, ADRs minimos, CI/CD, cobertura ≥ 70% |
| **Production** | Sistema en produccion | Resiliencia completa, cobertura ≥ 85%, GO/NO-GO gates |

Los agentes **Security**, **QA** e **Infrastructure** emiten un veredicto formal **GO / NO-GO / NO-GO condicional** con plan de remediacion priorizado (Inmediato / Corto plazo / Medio plazo).

Cada agente incluye un checklist de **self-audit** que ejecuta antes de entregar su respuesta, y formatos de respuesta obligatorios que garantizan consistencia entre sesiones.

---

### Orquestacion y delegacion paralela

El **DelegationBus** permite que el agente general coordine multiples especialistas en paralelo. Cuando el agente emite varios `ask_agent` en la misma respuesta, se ejecutan simultaneamente (hasta `maxParallelAgents`).

```
Usuario: "Agregar sistema de notificaciones en tiempo real"

general
  ├─ Wave 1 (paralelo)
  │   ├─ architecture → disena la solucion (WebSockets vs SSE)
  │   └─ security     → evalua superficie de ataque
  │
  └─ Wave 2 (paralelo, espera Wave 1)
      ├─ backend      → implementa el servidor WebSocket
      ├─ frontend     → implementa el cliente React
      └─ qa-engineer  → escribe tests + audita el resultado → save_audit
              ↓ (cada uno delega a)
           coder → ejecuta los cambios en el filesystem
```

---

### Deteccion automatica de stack

`createCodingEngine()` detecta el stack del proyecto al arrancar, chequeando archivos indicadores en el directorio de trabajo:

| Archivo indicador | Stack detectado |
|-------------------|-----------------|
| `package.json` | `node` |
| `tsconfig.json` | `typescript` |
| `requirements.txt` / `pyproject.toml` | `python` |
| `pom.xml` / `build.gradle` | `java` |
| `Cargo.toml` | `rust` |
| `go.mod` | `go` |
| `composer.json` | `php` |
| `Gemfile` | `ruby` |
| `mix.exs` | `elixir` |

El resultado se inyecta como `## Detected Project Stack` en el `projectContext` de **todos** los agentes (orquestador y especialistas). Actua como fallback automatico cuando todavia no se ha ejecutado `/init` y no existe `AGENT.md`.

Una vez ejecutado `/init`, el `AGENT.md` generado con la seccion `## Stack` tiene precedencia y complementa a la deteccion automatica.

---

### Herramientas de filesystem

| Herramienta | Descripcion |
|-------------|-------------|
| `read_file` | Lee el contenido de un archivo |
| `write_file` | Crea o sobrescribe un archivo, crea directorios padre automaticamente |
| `edit_file` | Reemplaza un string exacto dentro de un archivo |
| `list_directory` | Lista el directorio recursivamente hasta profundidad 3 |
| `search_files` | Grep recursivo con soporte de glob y case-insensitive |
| `run_command` | Ejecuta un comando shell con timeout configurable (default 30s) |

---

### Herramientas de memoria y contexto

| Herramienta | Que guarda | Donde |
|-------------|------------|-------|
| `save_context` | Descubrimientos del proyecto: stack, arquitectura, archivos clave | `memory/contexto-proyecto.md` |
| `save_learning` | Preferencias aprendidas del usuario en este proyecto | `learnings.md` |
| `save_user_preference` | Preferencias globales del usuario (todos los proyectos) | `~/.{appName}/USER.md` |
| `save_audit` | Reporte de auditoria estructurado al finalizar un proceso | `audits/{agente}-{fecha}.md` |
| `get_latest_audit` | Recupera el audit mas reciente de un agente especifico | `audits/` |
| `list_audits` | Lista todos los audits guardados del proyecto | `audits/` |

---

### ProjectStore — persistencia entre sesiones

El ProjectStore guarda el estado del proyecto en `~/.{appName}/projects/{project-key}/`. Usa una funcion unica de hash (`cwdToProjectKey`) en todo el framework para garantizar que todos los subsistemas lean y escriban en el mismo directorio.

Al inicializar, crea automaticamente `memory/session.md` si no existe — la primera vez que el agente trabaja en un proyecto ya tiene su archivo de sesion listo.

En cada sesion nueva, el engine inyecta automaticamente al system prompt de **todos los agentes**:

1. **User Profile** — `~/.{appName}/USER.md`
2. **Project Instructions** — `AGENT.md` del proyecto
3. **Project Context** — `memory/contexto-proyecto.md` (lo que el agente aprendio via `save_context`)
4. **Learned Preferences** — `learnings.md`
5. **Current Session** — `memory/session.md` (si existe)
6. **Lessons Learned** — `audits/lecciones-aprendidas.md` (si existe)
7. **Detected Project Stack** — detectado automaticamente por `detectProjectStack()` (fallback si no hay `AGENT.md`)

---

### AgentLoader — carga automatica de agentes

El framework carga agentes desde 3 ubicaciones en orden de prioridad:

```
Prioridad alta   → ./{cwd}/.bk-agent/agents/    (especificos del proyecto)
Prioridad media  → ~/.bk-agent/agents/           (globales, todos los proyectos)
Prioridad baja   → Builtins (CODING_AGENTS)      (los 9 agentes hardcoded)
```

Cada agente es un par de archivos:

```
{id}.json   — metadatos (name, icon, description, allowedTools, delegatesTo, provider)
{id}.md     — system prompt en markdown (sobrescribe el systemPrompt del JSON)
```

Si solo existe `{id}.md` sin su `.json`, sobrescribe el system prompt de un builtin conservando el resto de su configuracion.

---

## Estructura de datos en disco

Todo el estado se guarda en `~/.{appName}/`. El directorio del proyecto del usuario nunca se toca (excepto los archivos que el agente modifica explicitamente).

```
~/.bk-agent/                         ← o el appName que configures
│
├── config.json                      ← API keys, providers, defaultProvider
├── USER.md                          ← Perfil global del usuario (rol, estilo, preferencias)
│
├── workspaces.json                  ← Workspaces multi-proyecto
│
├── agents/                          ← Agentes globales (todos los proyectos)
│   ├── general.md                   ← Override del system prompt de un builtin
│   └── mi-agente-global.json + .md
│
├── skills/
│   ├── global/                      ← Skills agnosticos de lenguaje (YAML)
│   ├── packs/                       ← Packs instalados via SkillManager
│   └── sources.json                 ← Metadata de packs instalados
│
├── code-index/
│   └── {project-key}.db             ← SQLite: grafo de simbolos (MCP server)
│
└── projects/
    └── {project-key}/               ← Estado especifico del proyecto
        │
        ├── memory/
        │   ├── session.md           ← Sesion activa (feature, decisiones, issues)
        │   └── contexto-proyecto.md ← Stack, arquitectura, archivos clave (save_context)
        │
        ├── learnings.md             ← Preferencias del usuario en este proyecto
        ├── memory.json              ← Key-value persistente entre sesiones
        │
        ├── audits/
        │   ├── security-2025-05-29.md
        │   ├── qa-engineer-2025-05-29.md
        │   └── lecciones-aprendidas.md  ← Reflection engine
        │
        ├── checkpoints/
        │   ├── checkpoint-auth-login-2025-05-29-1430.md
        │   └── checkpoint-2025-05-29-0900.md
        │
        └── skills/                  ← Skills especificos de este proyecto
```

---

## Comando /init — inicializacion de proyectos

El comando `/init` analiza el proyecto y genera automaticamente la documentacion necesaria para que los agentes trabajen con contexto completo. Lo ejecuta el agente **`project-manager`** (builtin), que coordina a los especialistas en fases paralelas y secuenciales. Detecta tres modos automaticamente:

| Modo | Cuando aplica | Que genera |
|------|---------------|------------|
| `new` | El proyecto tiene `prompt.md` pero poco o ningun codigo | Disena la arquitectura desde cero |
| `existing` | El proyecto tiene codigo pero no documentacion de agentes | Reverse-engineering del estado actual |
| `hybrid` | Tiene tanto codigo existente como `prompt.md` con nueva direccion | Analisis de gaps y plan de migracion |

### Archivos generados

| Archivo | Contenido |
|---------|-----------|
| `design.md` | Arquitectura actual: componentes, flujos, decisiones clave |
| `specification.md` | Contratos API, modelos de datos, interfaces |
| `security.md` | Findings priorizados P0-P3, requerimientos y mitigaciones |
| `roadmap.md` | Fases, prioridades y estado actual |
| `AGENT.md` | Instrucciones inyectadas en cada sesion: commands, stack, convenciones |

Al finalizar, `/init` llama `save_context` para persistir el contexto generado en `memory/contexto-proyecto.md`.

---

## Slash commands built-in

El framework registra 6 comandos via `registerBuiltinCommands()`. Cualquier app que use el framework los obtiene automaticamente.

### /help

Lista todos los comandos disponibles y pide al LLM que explique con que puede ayudar en el contexto del proyecto actual.

```
> /help
Available commands:
- /agents     List available agents
- /checkpoint Create / list / load session checkpoints
- /help       List commands and get AI guidance on what I can help with
- /skills     List loaded skills
- /status     Show current agent and model
- /workspace  Manage multi-project workspaces

[LLM responde]: Hola! Estoy trabajando en tu proyecto de API REST con NestJS.
Puedo ayudarte con...
```

### /agents

Lista todos los agentes disponibles (builtin, global y de proyecto).

```
> /agents
Agents:
  general            General — Orchestrator — analyzes requests and delegates to specialists
  coder              Coder — implements code precisely and efficiently
  backend            Backend Dev — REST/GraphQL APIs, controllers, services
  frontend           Frontend Dev — React, Vue, components, CSS/Tailwind
  qa-engineer        QA Engineer — tests, coverage, TDD/BDD
  security           Security Expert — OWASP, vulnerabilities, JWT, OAuth
  architecture       Architect — system design, DDD, microservices
  infrastructure     Infrastructure — Docker, Kubernetes, CI/CD
  data               Data Engineer — SQL, indexes, ETL
  devops-interno *   DevOps Interno — pipeline CI/CD de este proyecto [PROJECT]
```

### /skills

Lista los skills cargados en la sesion actual.

```
> /skills
Skills:
  conventional-commits    Conventional Commits format and types
  code-review             Code review checklist — 5 dimensions
  bk-circuit-breaker      Circuit Breaker pattern with @backendkit-labs/circuit-breaker
  bk-retry                Retry with exponential backoff
```

### /status

Muestra el agente activo y el modelo en uso.

```
> /status
Agent : general
Model : claude-sonnet-4-6
```

### /checkpoint

Sistema completo de checkpoints para guardar y retomar el estado de la sesion.

```
# Crear checkpoint (sin nombre — usa fecha y hora)
> /checkpoint
Checkpoint saved: (unnamed)
~/.bk-agent/projects/.../checkpoints/checkpoint-2025-05-29-1430.md

# Crear checkpoint con nombre de feature
> /checkpoint auth-login
Checkpoint saved: auth-login
~/.bk-agent/projects/.../checkpoints/checkpoint-auth-login-2025-05-29-1430.md

# Listar checkpoints (agrupados por feature, el mas reciente de cada una)
> /checkpoint list
  1. auth-login             2025-05-29 14:30  (3 versions)
  2. payments-flow          2025-05-28 11:00
  3. (unnamed)              2025-05-29 09:00  (2 versions)

# Cargar el checkpoint mas reciente (inyecta al contexto activo)
> /checkpoint load
Checkpoint loaded: auth-login

# Cargar un checkpoint especifico por nombre
> /checkpoint load payments-flow
Checkpoint loaded: payments-flow
```

### /workspace

Gestiona workspaces multi-proyecto — grupos de proyectos relacionados que no son un monorepo.

```
# Listar workspaces (* = proyecto activo)
> /workspace list
Workspaces (* = active project):
  mi-sistema           backend*, frontend, mobile
  otro-sistema         api

# Crear workspace
> /workspace create mi-sistema

# Agregar proyectos al workspace
> /workspace add mi-sistema C:\Projects\backend
Added "backend" to workspace "mi-sistema".

> /workspace add mi-sistema C:\Projects\frontend frontend-web
Added "frontend-web" to workspace "mi-sistema".

# Cambiar al workspace (inyecta contexto de todos los proyectos)
> /workspace switch mi-sistema
Workspace "mi-sistema" context loaded. Active project: backend

# Cambiar a un proyecto especifico dentro del workspace
> /workspace switch mi-sistema frontend-web
Switched to workspace "mi-sistema" — active: frontend-web

# Quitar un proyecto del workspace
> /workspace remove mi-sistema frontend-web
Removed "frontend-web" from workspace "mi-sistema".

# Eliminar workspace
> /workspace delete mi-sistema
Workspace "mi-sistema" deleted.
```

---

## Sistema de checkpoints

Los checkpoints son snapshots del estado de la sesion activa (`memory/session.md`). Permiten retomar el trabajo exactamente donde se dejo, incluso despues de cambiar de proyecto o reiniciar el agente.

### Como funciona

```
Trabajo en feature "auth-login"
        ↓
session.md se actualiza (agentes y /init escriben ahi)
        ↓
/checkpoint auth-login
        ↓
checkpoints/checkpoint-auth-login-2025-05-29-1430.md
(snapshot del session.md actual)
        ↓
[cambio de proyecto, reinicio, otra feature...]
        ↓
/checkpoint load auth-login
        ↓
El contenido del checkpoint se inyecta al contexto activo
El agente retoma con el contexto completo de donde estaba
```

### Formato de session.md

El archivo `memory/session.md` se crea automaticamente al inicializar el engine si no existe:

```markdown
---
project: mi-proyecto
created_at: 2025-05-29
updated_at: 2025-05-29
last_checkpoint: null
---

## Current Feature
*(none)*

## Decisions

## Active Issues

## Engine Learnings
```

Los agentes actualizan este archivo a medida que trabajan. `/init` lo rellena al generar la documentacion del proyecto.

### Naming de archivos

```
Sin nombre:   checkpoint-{YYYY-MM-DD}-{HHmm}.md
Con nombre:   checkpoint-{feature}-{YYYY-MM-DD}-{HHmm}.md
```

Multiples checkpoints del mismo nombre se acumulan (con timestamp distinto). `/checkpoint list` muestra el mas reciente de cada feature con el conteo de versiones.

---

## Workspaces multi-proyecto

Un workspace agrupa proyectos relacionados que no son un monorepo pero pertenecen al mismo sistema. Por ejemplo: un backend API, un frontend React y una app mobile que comparten dominio pero viven en repos separados.

### Estructura en disco

```
~/.{appName}/
└── workspaces.json
```

```json
{
  "mi-sistema": {
    "projects": [
      { "name": "backend",  "cwd": "C:\\Projects\\mi-sistema\\backend" },
      { "name": "frontend", "cwd": "C:\\Projects\\mi-sistema\\frontend" },
      { "name": "mobile",   "cwd": "C:\\Projects\\mi-sistema\\mobile" }
    ],
    "active": "backend"
  }
}
```

### Contexto inyectado al hacer /workspace switch

```markdown
## Workspace: mi-sistema
- **backend** *(active)* — `C:\Projects\mi-sistema\backend`
- **frontend** — `C:\Projects\mi-sistema\frontend`
- **mobile** — `C:\Projects\mi-sistema\mobile`

### backend — Context
Stack: Node.js, NestJS, PostgreSQL
API REST en puerto 3000...

### frontend — Context
Stack: React 18, TypeScript, Tailwind
SPA que consume el backend en /api...
```

El agente ve el contexto de todos los proyectos del workspace y puede razonar sobre las interacciones entre ellos.

### Cambiar de proyecto activo

```
/workspace switch mi-sistema frontend
```

Esto cambia el `cwd` del engine al directorio del frontend. Las herramientas de filesystem (`read_file`, `write_file`, `run_command`) operan sobre ese directorio. El contexto de todos los proyectos sigue disponible en el system prompt.

### API programatica

```typescript
import {
  loadWorkspaces,
  saveWorkspaces,
  createWorkspace,
  addProject,
  removeProject,
  deleteWorkspace,
  setActiveProject,
  buildWorkspaceContext,
} from '@bk/agent-core';

// Cargar workspaces
const config = await loadWorkspaces('mi-app');

// Crear y agregar proyectos
let updated = createWorkspace(config, 'mi-sistema');
updated = addProject(updated, 'mi-sistema', { name: 'backend', cwd: '/projects/backend' });
updated = addProject(updated, 'mi-sistema', { name: 'frontend', cwd: '/projects/frontend' });
await saveWorkspaces('mi-app', updated);

// Construir contexto para inyectar al agente
const context = await buildWorkspaceContext('mi-sistema', updated['mi-sistema'], 'mi-app');
```

---

## Sistema de Skills

Las skills son el mecanismo para inyectar conocimiento contextual en los agentes. Cuando el input del usuario hace match con los triggers de una skill, su contenido se inyecta automaticamente en el system prompt del agente activo.

### Como funciona

```
Input del usuario
       ↓
  SkillLoader.loadAll(cwd)        ← Carga skills de las 3 capas
       ↓
  SkillActivator.detectStack(cwd) ← Detecta tecnologias del proyecto
       ↓
  SkillActivator.activate(input, skills, stack)
       ↓                          ← Filtra por triggers + stack
  Skills activas
       ↓
  buildSystemPromptAddition()     ← Combina los prompts de cada skill
       ↓
  System prompt enriquecido → Agente → LLM
```

### Jerarquia de skills (3 capas)

```
Prioridad: proyecto > global > builtin

1. GLOBAL  (agnostico de lenguaje)
   ~/.{appName}/skills/global/
   + GLOBAL_BUILTIN_SKILLS (hardcoded en el framework)

2. PACKS  (especificos por lenguaje o dominio)
   ~/.{appName}/skills/packs/{pack-name}/
   + NODE_PACK_SKILLS (builtin para Node/TypeScript)

3. PROYECTO  (especificos del proyecto actual)
   ~/.{appName}/projects/{project-key}/skills/
```

### Estructura de una Skill

```typescript
interface Skill {
  name: string;
  version: string;
  description: string;
  triggers: string[];           // Palabras clave que activan el skill
  language?: string[];          // undefined = cualquier lenguaje
  systemPromptAddition?: string; // Contenido inyectado en el system prompt
  scope?: 'global' | 'pack' | 'project';
  pack?: string;
  agents?: string[];            // AgentIds que siempre tienen este skill activo
}
```

### Definir una skill en YAML

```yaml
name: deploy-kubernetes
version: 1.0.0
description: Guia para deployar en Kubernetes usando Helm
scope: pack
pack: mi-infra-skills
language:
  - node
  - python
  - go
triggers:
  - kubernetes
  - k8s
  - helm
  - deploy
systemPromptAddition: |
  ## Deploy en Kubernetes

  Siempre usar Helm. Nunca aplicar manifests YAML directamente en produccion.
  - Siempre definir resources.requests y resources.limits
  - livenessProbe y readinessProbe obligatorios
  - Secrets via ExternalSecret, nunca hardcoded
```

---

## Skills builtin

### Skills globales (siempre activos)

| Skill | Triggers principales | Que hace |
|-------|---------------------|----------|
| `conventional-commits` | commit, changelog, semver | Formato `<type>(<scope>): <desc>`, tipos validos, BREAKING CHANGE |
| `code-review` | code review, pull request, revision | Checklist 5 dimensiones: correctitud, legibilidad, mantenibilidad, seguridad, rendimiento |
| `tdd` | tdd, test-driven, red green refactor | Ciclo Red→Green→Refactor, patron AAA, que testear y que no |
| `adr` | adr, architecture decision | Formato ADR: Contexto, Decision, Consecuencias, Alternativas |
| `security-checklist` | seguridad, owasp, sql injection, xss | OWASP Top 10 simplificado, headers HTTP, errores genericos |

### Skills de Node/TypeScript (`@bk-node`)

Activos automaticamente cuando el proyecto tiene `package.json` o `tsconfig.json`.

| Skill | Triggers | Libreria |
|-------|----------|----------|
| `bk-result` | result monad, Result<T>, error tipado | `@backendkit-labs/result` |
| `bk-retry` | retry, reintentos, exponential backoff | `@backendkit-labs/retry` |
| `bk-circuit-breaker` | circuit breaker, fail fast, resilience | `@backendkit-labs/circuit-breaker` |
| `bk-bulkhead` | bulkhead, concurrencia, semaforo | `@backendkit-labs/bulkhead` |
| `bk-pipeline` | pipeline, chain of responsibility | `@backendkit-labs/pipeline` |
| `bk-http-client` | http client, axios, api externa | `@backendkit-labs/http-client` |
| `bk-observability` | logging, structured log, correlation id | NestJS interceptors + Winston |
| `bk-request-scanner` | sql injection, xss, path traversal | Middleware de deteccion |
| `bk-rate-limiter` | rate limiter, token bucket, sliding window | `@backendkit-labs/bulkhead` |
| `bk-idempotency` | idempotency, duplicate request | Idempotency keys pattern |
| `bk-auto-learning` | auto learning, self-tuning, adaptativo | Auto-tuning de resiliencia |
| `bk-console-animations` | spinner, progress bar, cli animation | `@backendkit-labs/console-animations` |

---

## Servidor MCP

El servidor MCP expone las capacidades del framework a cualquier cliente compatible con el protocolo MCP.

### Iniciar el servidor

```bash
BK_CWD=$(pwd) BK_APP_NAME=mi-app npx @bk/mcp-server
```

### Herramientas disponibles (7)

| Herramienta | Descripcion |
|-------------|-------------|
| `stack_detect` | Detecta el stack via archivos indicadores + grafo de imports (45 framework signatures) |
| `skills_search` | Busca skills por query, marca con ✓ los que coinciden con el stack del proyecto |
| `skills_install` | Instala un pack desde GitHub URL o path local |
| `skills_list` | Lista todos los packs instalados (builtin + externos) |
| `code_search` | Busca simbolos (funciones, clases, tipos) por nombre o keyword con FTS5 |
| `code_context` | Contexto de codigo para una tarea: simbolos relevantes + snippet + callers + callees |
| `code_index` | Re-indexacion manual (si los resultados estan desactualizados) |

### Lenguajes soportados

TypeScript, JavaScript, Python, Go, Rust, Java — via Tree-sitter (WASM) + SQLite FTS5.

### Configurar en Claude Code

```json
{
  "mcpServers": {
    "bk": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/server.js"],
      "env": {
        "BK_APP_NAME": "mi-app",
        "BK_CWD": "/ruta/al/proyecto"
      }
    }
  }
}
```

---

## Casos de uso basicos

### 1. Iniciar el asistente en un proyecto existente

```bash
cd mi-proyecto
node /path/to/coding-assistant/dist/index.js

> /init
# Detecta modo 'existing', ejecuta 6 fases en paralelo
# Genera: design.md, specification.md, security.md, roadmap.md, AGENT.md
# Guarda contexto en memory/contexto-proyecto.md
```

### 2. Pedir una feature al orquestador

```
> Agregar autenticacion con Google OAuth2

# general → delega en paralelo:
#   security → evalua superficie de ataque
#   backend  → implementa estrategia OAuth
#   coder    → escribe los archivos
#   qa-engineer → escribe tests + save_audit del proceso
```

### 3. Cambiar al agente especializado

```
> /agent security
# Ahora hablas directo con el Security Expert

> Revisa las rutas de autenticacion para vulnerabilidades
```

### 4. Guardar y retomar el trabajo

```
# Terminar el dia guardando el estado
> /checkpoint auth-feature
Checkpoint saved: auth-feature

# Al dia siguiente, retomar donde se dejo
> /checkpoint load auth-feature
Checkpoint loaded: auth-feature
# El agente tiene el contexto completo de donde estabas
```

---

## Casos de uso intermedios

### 5. Construir un asistente personalizado

```typescript
import { createCodingEngine } from '@bk/agent-coding';
import { CallbackTransport, SlashCommandRegistry, registerBuiltinCommands } from '@bk/agent-core';
import { getProjectDir } from '@bk/agent-core';
import { readFileSync } from 'fs';
import { join } from 'path';

const appName = 'mi-asistente';
const cwd = process.cwd();

const engine = createCodingEngine({
  providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } },
  defaultProvider: 'anthropic',
  defaultAgent: 'general',
  workingDir: cwd,
  appName,
  transport: new CallbackTransport(event => {
    if (event.type === 'token') process.stdout.write(event.content);
    if (event.type === 'tool_call') console.log(`\n[${event.name}]`);
    if (event.type === 'agent_switch') console.log(`\n→ ${event.to}`);
  }),
});

// Registrar comandos slash
const registry = new SlashCommandRegistry();
registerBuiltinCommands(registry);

// Dispatcher: comandos primero, engine despues
async function run(input: string) {
  const projectDir = getProjectDir(appName, cwd);
  let sessionContent = '';
  try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}

  const handled = await registry.dispatch(input, {
    emit: text => console.log(text),
    appName,
    projectDir,
    sessionContent,
    injectContext: msg => console.log('[context]', msg),
    onCwdChange: newCwd => console.log('[cwd]', newCwd),
    runEngine: prompt => engine.run(prompt),
  });

  if (!handled) await engine.run(input);
}
```

### 6. Crear un agente personalizado para el proyecto

```json
// mi-proyecto/.bk-agent/agents/devops-interno.json
{
  "id": "devops-interno",
  "name": "DevOps Interno",
  "icon": "⚙",
  "description": "Especialista en el pipeline CI/CD de este proyecto",
  "allowedTools": ["read_file", "write_file", "edit_file", "run_command", "search_files", "save_context"],
  "delegatesTo": ["coder"],
  "provider": "deepseek"
}
```

```markdown
<!-- mi-proyecto/.bk-agent/agents/devops-interno.md -->
Sos el especialista en DevOps de este proyecto. Conoces:
- El pipeline en .github/workflows/
- El Helm chart en charts/mi-app/
- Los secretos en AWS Secrets Manager (nunca los hardcodees)

Cuando modificas el pipeline, siempre ejecuta 'act' para validar localmente.
```

### 7. Gestionar workspaces multi-proyecto desde codigo

```typescript
import {
  loadWorkspaces, saveWorkspaces, createWorkspace, addProject, buildWorkspaceContext
} from '@bk/agent-core';

const appName = 'mi-app';

// Crear workspace con los tres servicios del sistema
let config = await loadWorkspaces(appName);
config = createWorkspace(config, 'fintech-system');
config = addProject(config, 'fintech-system', { name: 'payments-api', cwd: '/projects/payments' });
config = addProject(config, 'fintech-system', { name: 'fraud-service', cwd: '/projects/fraud' });
config = addProject(config, 'fintech-system', { name: 'dashboard',    cwd: '/projects/dashboard' });
await saveWorkspaces(appName, config);

// Obtener el contexto combinado de todos los proyectos
const ws = config['fintech-system'];
const context = await buildWorkspaceContext('fintech-system', ws, appName);
// context contiene memory/contexto-proyecto.md de los 3 proyectos
```

---

## Casos de uso avanzados

### 8. Usar el MCP server para code context en un agente

```typescript
async function handleMessage(message: string) {
  const [context, stack] = await Promise.all([
    mcp.callTool('code_context', { task: message, max_symbols: 8 }),
    mcp.callTool('stack_detect', {}),
  ]);

  return llm.chat([
    { role: 'system', content: [systemPrompt, context.content[0].text].join('\n\n---\n\n') },
    { role: 'user', content: message },
  ]);
}
```

### 9. Suscribirse a todos los eventos del engine

```typescript
import { CallbackTransport } from '@bk/agent-core';

const transport = new CallbackTransport(event => {
  switch (event.type) {
    case 'block_start':  console.log(`[${event.agent_id}] iniciando...`); break;
    case 'agent_switch': console.log(`delegando: ${event.from} → ${event.to}`); break;
    case 'token':        process.stdout.write(event.content); break;
    case 'tool_call':    console.log(`\n  tool: ${event.name}`); break;
    case 'tool_result':  console.log(`  → ${event.success ? 'ok' : 'error'}`); break;
    case 'done':         console.log('\n✓ completado'); break;
    case 'error':        console.error(`\n✗ ${event.message}`); break;
  }
});
```

### 10. Override del system prompt de un agente builtin

```markdown
<!-- ~/.bk-agent/agents/general.md -->
Sos el orquestador de equipo de backend en [Mi Empresa].
Siempre que el usuario pida una feature, primero pregunta si hay tickets en Jira
relacionados antes de empezar a implementar.

Nuestras convenciones internas:
- Todas las PRs necesitan review de al menos 2 personas
- Nunca deployar los viernes
- Branches: {tipo}/{ticket-id}-{descripcion}
```

---

## Crear agentes personalizados

### Agente de proyecto (visible solo en ese proyecto)

```
mi-proyecto/.bk-agent/agents/
├── mi-agente.json
└── mi-agente.md
```

### Agente global (disponible en todos los proyectos)

```
~/.bk-agent/agents/
├── mi-agente.json
└── mi-agente.md
```

### Scaffoldear un agente nuevo

```
> /agent new database-expert          # Crea en .bk-agent/agents/ del proyecto
> /agent new database-expert --global # Crea en ~/.bk-agent/agents/
```

### Schema del .json

```json
{
  "id": "database-expert",
  "name": "Database Expert",
  "icon": "⊞",
  "description": "Especialista en PostgreSQL y optimizacion de queries",
  "allowedTools": ["read_file", "write_file", "edit_file", "run_command",
                   "search_files", "save_context", "save_learning"],
  "delegatesTo": ["coder"],
  "provider": "deepseek"
}
```

---

## Instalar packs externos de skills

```typescript
import { SkillManager } from '@bk/agent-core';

const manager = new SkillManager('mi-app');
await manager.install('https://github.com/mi-org/skills-pack');
await manager.install('https://github.com/mi-org/skills-pack', { skill: 'deploy-k8s' });
await manager.update('@mi-org/skills-pack');
await manager.uninstall('@mi-org/skills-pack');
```

**Garantia de atomicidad:** el manager descarga todo en memoria. Solo escribe al disco si todos los fetches tienen exito.

---

## Crear tu propio pack de skills

```
mi-skills-pack/
├── skills/
│   ├── deploy-kubernetes.yaml
│   ├── terraform.yaml
│   └── datadog.yaml
└── README.md
```

Cualquier repositorio GitHub publico puede usarse como pack:

```bash
npx @bk/mcp-server install https://github.com/mi-org/mi-skills-pack
```

---

## Integracion con Claude Code / Cursor

### Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "bk": {
      "command": "node",
      "args": ["/path/to/agent-framework/packages/mcp-server/dist/server.js"],
      "env": { "BK_APP_NAME": "claude-code", "BK_CWD": "/ruta/a/tu/proyecto" }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "agent-framework": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/server.js"],
      "env": { "BK_APP_NAME": "cursor", "BK_CWD": "${workspaceFolder}" }
    }
  }
}
```

---

## Librerias de resiliencia

```typescript
import { ok, err } from '@backendkit-labs/result';
import { withRetry } from '@backendkit-labs/retry';
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';
import { Bulkhead } from '@backendkit-labs/bulkhead';

// Orden de composicion: Bulkhead > CircuitBreaker > Retry
const bulkhead = new Bulkhead({ maxConcurrent: 10, maxQueue: 50 });
const cb = new CircuitBreaker({ threshold: 5, timeout: 10_000 });

async function callExternalService(payload: unknown) {
  return bulkhead.execute(() =>
    cb.execute(() =>
      withRetry(() => fetch('/api', { method: 'POST', body: JSON.stringify(payload) }),
        { maxAttempts: 3, backoff: 'exponential' })
    )
  );
}
```

### `ResilientLLMClient`

```typescript
import { ResilientLLMClient } from '@bk/agent-core';

const client = new ResilientLLMClient({
  client: myLLMClient,
  name: 'openai',
  failureThreshold: 50,   // % de fallos para abrir el circuit
  openTimeoutMs: 30_000,  // ms antes de intentar recovery
});
```

---

## Integrar los slash commands en tu app

Para conectar los 6 comandos built-in a tu app, necesitas instanciar el registry, pasarle los callbacks correctos y despachar antes de enviar al engine.

```typescript
import { SlashCommandRegistry, registerBuiltinCommands, getProjectDir } from '@bk/agent-core';
import { readFileSync } from 'fs';
import { join } from 'path';

const appName = 'mi-app';
const registry = new SlashCommandRegistry();
registerBuiltinCommands(registry);

// Tambien podes registrar comandos propios
registry.register('/clear', 'Limpiar pantalla', async (ctx) => {
  console.clear();
  ctx.emit('Sesion reiniciada.');
});

async function handleInput(text: string, cwd: string, engine: AgentEngine) {
  if (!registry.isCommand(text)) {
    await engine.run(text);
    return;
  }

  const projectDir = getProjectDir(appName, cwd);
  let sessionContent = '';
  try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}

  await registry.dispatch(text, {
    emit: (msg) => console.log(msg),                    // /help, /agents, /status, etc.
    appName,                                             // requerido por /workspace
    projectDir,                                          // requerido por /checkpoint
    sessionContent,                                      // snapshot del session.md para /checkpoint
    injectContext: (msg) => console.log('[ctx]', msg),  // /workspace switch, /checkpoint load
    onCwdChange: (newCwd) => restartEngine(newCwd),     // /workspace switch con cambio de proyecto
    runEngine: (prompt) => engine.run(prompt),           // /help → LLM responde
  });
}
```

### Campos de `CommandContext`

| Campo | Tipo | Requerido por |
|-------|------|---------------|
| `emit` | `(text: string) => void` | todos |
| `appName` | `string` | `/workspace` |
| `projectDir` | `string` | `/checkpoint` |
| `sessionContent` | `string` | `/checkpoint` (crear) |
| `agents` | `CommandAgentInfo[]` | `/agents` |
| `skills` | `CommandSkillInfo[]` | `/skills` |
| `effectiveAgentId` | `string` | `/status` |
| `model` | `string` | `/status` |
| `injectContext` | `(msg: string) => void` | `/workspace switch`, `/checkpoint load` |
| `onCwdChange` | `(cwd: string) => void` | `/workspace switch` |
| `runEngine` | `(prompt: string) => Promise<void>` | `/help` |

---

## Roadmap

### Completado en v0.3.0

- [x] **10 agentes**: agente `project-manager` builtin — coordinador dedicado del workflow `/init`
- [x] **Prompts enriquecidos**: todos los agentes con modos de madurez (Prototype/Beta/Production), checklists accionables por dominio, tablas de severidad, self-audit y formatos de respuesta obligatorios
- [x] **Veredictos GO/NO-GO**: Security, QA e Infrastructure emiten dictamen formal con plan de remediacion (Inmediato / Corto / Medio plazo)
- [x] **Deteccion automatica de stack**: `detectProjectStack()` chequea 11 archivos indicadores al arrancar e inyecta el stack en el contexto de todos los agentes
- [x] **Contexto universal**: `AgentEngine.buildSystemPrompt` ahora inyecta `projectContext` en todos los agentes (no solo el orquestador) — los especialistas conocen el stack y la sesion activa sin depender de lo que General les pase

### Completado en v0.2.0

- [x] Motor multi-agente con bus de delegacion paralela (max 6 agentes por wave)
- [x] 9 agentes especializados con roles y herramientas bien definidas
- [x] InitWorkflow: new / existing / hybrid con documentacion generada automaticamente
- [x] ProjectStore con clave unica unificada (`cwdToProjectKey`) en todo el framework
- [x] Estructura canonica `~/.{appName}/projects/{key}/memory/` y `audits/`
- [x] `session.md` — auto-creado al inicializar, actualizado por agentes e `/init`
- [x] Sistema de checkpoints: naming con timestamp, lista agrupada, load por inyeccion
- [x] Workspaces multi-proyecto: CRUD, switch con contexto combinado, `onCwdChange` callback
- [x] 6 slash commands built-in: `/help`, `/agents`, `/skills`, `/status`, `/checkpoint`, `/workspace`
- [x] `/help` invoca el LLM para guia contextual ademas de listar comandos
- [x] `runEngine` en `CommandContext` — cualquier comando puede invocar el LLM
- [x] 5 proveedores LLM: Anthropic, DeepSeek, OpenAI, Kimi, Grok
- [x] Sistema de skills jerarquico (global / pack / proyecto) con 17 skills builtin
- [x] SkillManager: install / uninstall / list / update (atomicidad garantizada)
- [x] Servidor MCP con 7 herramientas, indexador Tree-sitter (6 lenguajes) + SQLite FTS5
- [x] Integracion BackendKit Labs: Result, Retry, CircuitBreaker, Bulkhead, Pipeline

### Planificado

- [ ] Skills con handlers TypeScript (no solo YAML estatico)
- [ ] `agent_context` — herramienta MCP que combina code intelligence + skills en una llamada
- [ ] Indexacion de Ruby, PHP, Elixir, Kotlin
- [ ] Embeddings semanticos para busqueda por significado
- [ ] Panel de administracion de skills via CLI interactivo
- [ ] `npx @bk/create-agent` para scaffolding de nuevos proyectos

---

## Contribuir

```bash
git clone https://github.com/BackendKit-labs/backendkit-agent-framework.git
cd agent-framework
npm install
npm run build

git checkout -b feat/mi-feature
npm run typecheck

git commit -m "feat(skills): add elixir stack detection"
```

---

## Licencia

MIT
