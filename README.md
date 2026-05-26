# agent-framework

Framework multi-agente para asistentes de codigo, construido en TypeScript con arquitectura monorepo. Disenado para ser agnnostico de LLM, agnnostico de transporte y extensible mediante un sistema jerarquico de skills.

---

## Tabla de contenidos

1. [Vision general](#vision-general)
2. [Arquitectura](#arquitectura)
3. [Instalacion](#instalacion)
4. [Quickstart — REPL interactivo](#quickstart--repl-interactivo)
5. [Packages](#packages)
6. [Motor de agentes — @bk/agent-coding](#motor-de-agentes--bkagent-coding)
   - [Proveedores LLM](#proveedores-llm)
   - [Los 9 agentes especializados](#los-9-agentes-especializados)
   - [Orquestacion y delegacion paralela](#orquestacion-y-delegacion-paralela)
   - [Herramientas de filesystem](#herramientas-de-filesystem)
   - [Herramientas de memoria y contexto](#herramientas-de-memoria-y-contexto)
   - [ProjectStore — persistencia entre sesiones](#projectstore--persistencia-entre-sesiones)
   - [AgentLoader — carga automatica de agentes](#agentloader--carga-automatica-de-agentes)
7. [Comando /init — inicializacion de proyectos](#comando-init--inicializacion-de-proyectos)
8. [Slash commands](#slash-commands)
9. [Sistema de Skills](#sistema-de-skills)
10. [Skills builtin](#skills-builtin)
11. [Servidor MCP](#servidor-mcp)
12. [Casos de uso basicos](#casos-de-uso-basicos)
13. [Casos de uso intermedios](#casos-de-uso-intermedios)
14. [Casos de uso avanzados](#casos-de-uso-avanzados)
15. [Crear agentes personalizados](#crear-agentes-personalizados)
16. [Instalar packs externos de skills](#instalar-packs-externos-de-skills)
17. [Crear tu propio pack de skills](#crear-tu-propio-pack-de-skills)
18. [Integracion con Claude Code / Cursor](#integracion-con-claude-code--cursor)
19. [Librerias de resiliencia](#librerias-de-resiliencia)
20. [Estructura de datos en disco](#estructura-de-datos-en-disco)
21. [Roadmap](#roadmap)

---

## Vision general

**agent-framework** resuelve tres problemas concretos al construir asistentes de codigo con LLMs:

| Problema | Solucion |
|----------|----------|
| Un solo agente no puede hacer todo bien | **9 agentes especializados** orquestados por un agente general |
| Los agentes olvidan convenciones del proyecto | **Skills + ProjectStore**: contexto persistente entre sesiones |
| Las llamadas a LLMs fallan o son lentas | **Resiliencia integrada**: CircuitBreaker, Retry, Bulkhead |

El framework no impone un LLM especifico. Funciona con DeepSeek, Anthropic (Claude), OpenAI, Kimi (Moonshot) o Grok.

---

## Arquitectura

```
agent-framework/
├── packages/
│   ├── core/          @bk/agent-core     — Motor generico, skills, orquestacion base
│   ├── coding/        @bk/agent-coding   — 9 agentes, filesystem tools, LLM providers, /init
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
git clone https://github.com/backendkit-dev/agent-framework.git
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
    "openai": { "apiKey": "sk-..." }
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
> /init              # Analizar el proyecto y generar documentacion
> /agent list        # Ver todos los agentes disponibles
> /agent backend     # Cambiar al agente backend
> Como agrego autenticacion JWT a la API?
> /cwd /otro/proyecto
```

---

## Packages

### `@bk/agent-core`

Motor generico del framework. Model-agnostic, transport-agnostic. Exporta el engine, sistema de skills, orquestacion, reflection y utilidades compartidas.

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
// Usar un provider especifico para un agente puntual
const engine = createCodingEngine({
  providers: {
    anthropic: { apiKey: '...', model: 'claude-opus-4-7' },
    deepseek:  { apiKey: '...', model: 'deepseek-coder' },
  },
  defaultProvider: 'anthropic',
  // El agente 'coder' puede usar deepseek para menor costo
});
```

La variable `AGENT_PROVIDER` fuerza el provider sin cambiar la config:

```bash
AGENT_PROVIDER=deepseek node dist/index.js
```

---

### Los 9 agentes especializados

El framework incluye 9 agentes con roles bien definidos. El agente **general** actua como orquestador y nunca escribe codigo directamente — delega a los especialistas.

#### Agente `general` (Orquestador)

- Analiza la solicitud del usuario
- Decide cuales especialistas necesita y en que orden
- Emite multiples `ask_agent` en la misma respuesta para ejecucion paralela
- Maximo 6 agentes en paralelo por wave; multiples waves para tareas grandes
- Tiene acceso a herramientas de lectura y memoria (no escribe archivos)

#### Agente `coder` (Implementador puro)

- Recibe planes de los especialistas y los ejecuta
- Siempre lee los archivos antes de editarlos
- Prefiere `edit_file` sobre `write_file` para archivos existentes
- Ejecuta comandos para verificar que los cambios funcionan
- Reporta concisamente lo que hizo

#### Agente `backend`

- APIs REST y GraphQL
- NestJS, Express, Fastify
- TypeORM, Prisma, Sequelize
- Validacion de inputs, manejo de errores, dependency injection
- Delega implementacion a `coder`

#### Agente `frontend`

- React, Vue 3, Angular
- TypeScript, Tailwind CSS
- Accesibilidad WCAG 2.1
- Componentes pequenos y reutilizables
- State management: Zustand, Pinia, Redux
- Delega implementacion a `coder`

#### Agente `qa-engineer`

El QA Engineer tiene dos responsabilidades que lo definen: **crear tests** y **auditar cada proceso importante que termina**. Cada vez que otro agente completa un analisis, una feature o una refactorizacion significativa, el QA audita el resultado y persiste el reporte via `save_audit`.

- Unit tests (Jest, Vitest, Mocha)
- Integration tests (Supertest, Testing Library)
- E2E tests (Playwright, Cypress)
- TDD / BDD, analisis de cobertura
- Nombres de test: `"should [behavior] when [condition]"`
- **Audita** cada proceso importante al finalizar → `save_audit` con reporte estructurado
- **Revisa** el output de otros agentes (architecture, backend, security) antes de darlo por cerrado
- Delega implementacion de tests a `coder`

#### Agente `security`

- OWASP Top 10
- JWT, OAuth 2.0, session management
- RBAC / ABAC, policy enforcement
- SQL injection, XSS, CSRF
- Secrets management, hardening
- Delega remediaciones a `coder`

#### Agente `architecture`

- Domain-Driven Design (DDD)
- Microservicios vs monolito (con trade-offs)
- Event-driven, CQRS, Event Sourcing
- C4 model, ADRs
- Delega a `coder`, `backend` y `frontend`

#### Agente `infrastructure`

- Docker y Docker Compose
- Kubernetes (manifests, Helm, operators)
- CI/CD: GitHub Actions, GitLab CI, Jenkins
- Cloud: AWS, GCP, Azure
- Terraform, Nginx, monitoring
- Delega a `coder`

#### Agente `data`

- SQL optimization, indexes, query plans
- Schema design, normalizacion
- ETL/ELT, data warehousing
- Spark, pandas, dbt
- Disena schemas para access patterns
- Solo tiene herramientas de lectura — delega escritura a `coder`

---

### Orquestacion y delegacion paralela

El **DelegationBus** permite que el agente general coordine multiples especialistas en paralelo. Cuando el agente emite varios `ask_agent` en la misma respuesta, se ejecutan simultaneamente (hasta `maxParallelAgents`).

```
Usuario: "Agregar sistema de notificaciones en tiempo real"

general
  ├─ Wave 1 (paralelo)
  │   ├─ architecture → disena la solucion (WebSockets vs SSE vs polling)
  │   └─ security     → evalua superficie de ataque
  │
  └─ Wave 2 (paralelo, espera Wave 1)
      ├─ backend      → implementa el servidor WebSocket
      ├─ frontend     → implementa el cliente React
      ├─ qa-engineer  → escribe los tests de integracion
      │                 + audita el resultado completo → save_audit
              ↓ (cada uno delega a)
           coder → ejecuta los cambios en el filesystem
```

Los eventos de delegacion se propagan al transport:

```typescript
engine.on('agent_switch', ({ from, to, reason }) => {
  console.log(`${from} → ${to}: ${reason}`);
});
```

---

### Herramientas de filesystem

Todos los agentes con permisos de escritura tienen acceso a estas herramientas:

| Herramienta | Descripcion |
|-------------|-------------|
| `read_file` | Lee el contenido de un archivo (resuelve paths relativos y absolutos) |
| `write_file` | Crea o sobrescribe un archivo, crea directorios padre automaticamente |
| `edit_file` | Reemplaza un string exacto dentro de un archivo. Error si hay multiples ocurrencias sin `replace_all=true` |
| `list_directory` | Lista el directorio recursivamente hasta profundidad 3 (ignora node_modules, .git) |
| `search_files` | Grep recursivo con soporte de glob y case-insensitive. Retorna hasta 200 lineas |
| `run_command` | Ejecuta un comando shell con timeout configurable (default 30s). Bloqueados: `rm -rf /`, `format`, `del /f /s /q c:\` |

Los agentes de solo-lectura (`general`, `data`) no tienen `write_file`, `edit_file` ni `run_command`.

---

### Herramientas de memoria y contexto

Todos los agentes tienen acceso a herramientas de persistencia para mantener contexto entre sesiones:

| Herramienta | Que guarda | Donde |
|-------------|------------|-------|
| `save_context` | Descubrimientos del proyecto: stack, arquitectura, archivos clave | `context.md` del proyecto |
| `save_learning` | Preferencias aprendidas del usuario en este proyecto | `learnings.md` del proyecto |
| `save_user_preference` | Preferencias globales del usuario (aplica a todos los proyectos) | `USER.md` global |
| `append_log` | Actividad reciente con timestamp ISO | `log.md` del proyecto |
| `save_audit` | Reporte de auditoria al finalizar un proceso importante. Responsabilidad del `qa-engineer` | `audits/{agente}-{fecha}.md` |
| `get_latest_audit` | Recupera el audit mas reciente de un agente especifico | `audits/` |
| `list_audits` | Lista todos los audits guardados del proyecto | `audits/` |

---

### ProjectStore — persistencia entre sesiones

El ProjectStore guarda el estado del proyecto en `~/.{appName}/projects/{cwd-hash}/`. Cada directorio de trabajo tiene su propio store.

```
~/.bk-agent/projects/abc123def/
├── context.md        ← Stack detectado, arquitectura, archivos clave, convenciones
├── learnings.md      ← Preferencias del usuario aprendidas en este proyecto
├── log.md            ← Actividad reciente (ultimas 20 lineas en el system context)
├── memory.json       ← Key-value persistente para datos entre sesiones
└── audits/
    ├── security-2025-05-26.md
    └── qa-engineer-2025-05-26.md
```

En cada sesion nueva, el engine construye automaticamente el system context con:

1. **User Profile** — `~/.bk-agent/USER.md` (rol, estilo de trabajo, preferencias globales)
2. **Project Instructions** — `AGENT.md` del proyecto (convenciones, stack, que no tocar)
3. **Project Context** — `context.md` (lo que el agente ya aprendio del proyecto)
4. **Learned Preferences** — `learnings.md` (correcciones y preferencias del usuario)
5. **Recent Activity** — ultimas 20 lineas del `log.md`

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

## Comando /init — inicializacion de proyectos

El comando `/init` analiza el proyecto y genera automaticamente la documentacion necesaria para que los agentes trabajen con contexto completo. Detecta tres modos automaticamente:

| Modo | Cuando aplica | Que genera |
|------|---------------|------------|
| `new` | El proyecto tiene `prompt.md` pero poco o ningun codigo | Disena la arquitectura desde cero |
| `existing` | El proyecto tiene codigo pero no documentacion de agentes | Reverse-engineering del estado actual |
| `hybrid` | Tiene tanto codigo existente como `prompt.md` con nueva direccion | Analisis de gaps y plan de migracion |

### Archivos generados (todos los modos)

| Archivo | Contenido |
|---------|-----------|
| `design.md` | Arquitectura actual: componentes, flujos, decisiones clave (documento estable) |
| `specification.md` | Contratos API, modelos de datos, interfaces (con "Undocumented" donde hay gaps) |
| `security.md` | Findings de seguridad priorizados P0-P3, requerimientos y mitigaciones |
| `roadmap.md` | Fases, prioridades y estado actual (documento vivo, se actualiza con cada tarea) |
| `AGENT.md` | Instrucciones operacionales inyectadas en cada sesion: commands, stack, convenciones, que NO tocar |

### Flujo para proyecto nuevo (5 fases)

```
PHASE 1 (paralelo)
  architecture → lee prompt.md, crea design.md
  backend      → crea specification.md

PHASE 2 (paralelo, espera Phase 1)
  security     → audita design + spec, crea security.md
  qa-engineer  → agrega seccion QA Review a specification.md

PHASE 3 (espera Phase 2)
  architecture → lee los 3 docs, crea roadmap.md con fases priorizadas

PHASE 4
  general      → crea AGENT.md con stack, convenciones y comandos

PHASE 5
  general      → save_context + append_log (completa /init)
```

### Flujo para proyecto existente (6 fases)

```
PHASE 1
  general → explore: lee package.json, README, entry points

PHASE 2 (paralelo)
  architecture → reverse-engineer la arquitectura real, crea design.md
  backend      → documenta lo que existe, marca gaps como "Undocumented"

PHASE 3 (paralelo)
  security     → findings priorizados P0 (critico) a P3 (informativo)
  qa-engineer  → agrega QA Findings a specification.md

PHASE 4 (espera Phase 3)
  architecture → roadmap con P0/P1 findings primero, luego features

PHASE 5
  general → AGENT.md reverse-engineered desde el codigo real

PHASE 6
  general → save_context + append_log
```

### Flujo para proyecto hibrido (6 fases)

Similar al existente pero la Phase 1 lee tanto `prompt.md` (direction deseada) como el codigo actual, y todos los documentos incluyen secciones "Current State vs Target" y "Migration Path".

---

## Slash commands

Disponibles desde cualquier REPL construido con el framework:

| Comando | Descripcion |
|---------|-------------|
| `/init` | Detecta modo (new/existing/hybrid) y ejecuta el InitWorkflow |
| `/agent list` | Lista todos los agentes disponibles (builtin / global / project) |
| `/agent <id>` | Cambia al agente especificado |
| `/agent new <id>` | Scaffoldea un nuevo agente en `.{appName}/agents/` del proyecto |
| `/agent new <id> --global` | Scaffoldea el agente en `~/.{appName}/agents/` (todos los proyectos) |
| `/cwd <path>` | Cambia el directorio de trabajo activo |
| `/clear` | Limpia la pantalla |
| `/quit` | Sale del REPL |

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

1. GLOBAL  (agnnostico de lenguaje)
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

  ```yaml
  # Estructura de chart obligatoria
  charts/mi-servicio/
  ├── Chart.yaml
  ├── values.yaml
  └── templates/
  ```

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

### Lenguajes soportados por el indexador

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
# Agente: general (orquestador)
> /init
# Detecta modo 'existing', ejecuta 6 fases en paralelo
# Genera: design.md, specification.md, security.md, roadmap.md, AGENT.md
```

### 2. Pedir una feature al orquestador

```
> Agregar autenticacion con Google OAuth2

# El agente general:
# 1. Analiza la solicitud
# 2. Delega en paralelo a: security (evalua) + backend (implementa estrategia)
# 3. Coder escribe los archivos
# 4. qa-engineer escribe los tests + audita el proceso completo (save_audit)
# 5. save_context con los nuevos archivos tocados
# 6. append_log con la actividad
```

### 3. Cambiar al agente especializado directamente

```
> /agent security
# Ahora hablas directo con el Security Expert

> Revisa las rutas de autenticacion para vulnerabilidades
# Analiza JWT, session management, CSRF sin pasar por el orquestador
```

### 4. Activar skills segun el input

```typescript
import { SkillLoader, SkillActivator, GLOBAL_BUILTIN_SKILLS, NODE_PACK_SKILLS } from '@bk/agent-core';

const loader = new SkillLoader('mi-app');
const activator = new SkillActivator();

const loaded = await loader.loadAll('/ruta/al/proyecto');
const allSkills = [...GLOBAL_BUILTIN_SKILLS, ...NODE_PACK_SKILLS, ...loaded.global, ...loaded.packs, ...loaded.project];

const stack = await activator.detectStack('/ruta/al/proyecto');
// → ['node', 'typescript']

const activeSkills = activator.activate('como hago un commit?', allSkills, stack);
// → [Skill { name: 'conventional-commits', ... }]

const addition = activator.buildSystemPromptAddition(activeSkills);
// → "## Conventional Commits\n\n..."
```

---

## Casos de uso intermedios

### 5. Construir un asistente personalizado

```typescript
import { createCodingEngine } from '@bk/agent-coding';
import { CallbackTransport } from '@bk/agent-core';

const engine = createCodingEngine({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-opus-4-7' },
    deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY },
  },
  defaultProvider: 'anthropic',
  defaultAgent: 'general',
  workingDir: '/mi/proyecto',
  appName: 'mi-asistente',
  transport: new CallbackTransport(event => {
    if (event.type === 'token') process.stdout.write(event.text);
    if (event.type === 'tool_call') console.log(`\n[${event.tool}]`);
    if (event.type === 'agent_switch') console.log(`\n→ ${event.to}`);
    if (event.type === 'metrics') console.log(`Tokens: ${event.total}, Costo: $${event.cost}`);
  }),
});

await engine.run('Refactorizar el modulo de pagos para soportar múltiples proveedores');
```

### 6. Crear un agente personalizado para el proyecto

Crear `.bk-agent/agents/` en el proyecto:

```
mi-proyecto/
└── .bk-agent/
    └── agents/
        ├── devops-interno.json
        └── devops-interno.md
```

```json
// devops-interno.json
{
  "id": "devops-interno",
  "name": "DevOps Interno",
  "icon": "⚙",
  "description": "Especialista en el pipeline de CI/CD de este proyecto",
  "allowedTools": ["read_file", "write_file", "edit_file", "run_command", "search_files"],
  "delegatesTo": ["coder"],
  "provider": "deepseek"
}
```

```markdown
<!-- devops-interno.md -->
Sos el especialista en DevOps de este proyecto. Conoces en detalle:
- El pipeline de GitHub Actions en .github/workflows/
- El Helm chart en charts/mi-app/
- Los secrets en AWS Secrets Manager (nunca los hardcodees)
- El entorno de staging en EKS y produccion en GKE

Cuando modificas el pipeline, siempre ejecuta 'act' para validar localmente.
```

Una vez creado, aparece automaticamente:

```
> /agent list
  [builtin] general, coder, backend, frontend, qa-engineer, security, architecture, infrastructure, data
  [project] devops-interno
```

### 7. Instalar un pack de skills desde GitHub

```typescript
import { SkillManager } from '@bk/agent-core';

const manager = new SkillManager('mi-app');

// Pack completo
await manager.install('https://github.com/mi-org/skills-pack');

// Solo un skill especifico
await manager.install('https://github.com/mi-org/skills-pack', { skill: 'deploy-k8s' });

// Actualizar
await manager.update('@mi-org/skills-pack');

// Desinstalar
await manager.uninstall('@mi-org/skills-pack');
```

**Garantia de atomicidad:** el manager descarga todo en memoria. Solo escribe al disco si todos los fetches tienen exito.

---

## Casos de uso avanzados

### 8. Usar el MCP server para code context en un agente

```typescript
// El agente usa code_context antes de responder para obtener el codigo real del proyecto

async function handleMessage(message: string) {
  const [context, stack] = await Promise.all([
    mcp.callTool('code_context', { task: message, max_symbols: 8 }),
    mcp.callTool('stack_detect', {}),
  ]);

  const enrichedPrompt = [
    systemPrompt,
    context.content[0].text,  // simbolos relevantes + snippets + callers
  ].join('\n\n---\n\n');

  return llm.chat([
    { role: 'system', content: enrichedPrompt },
    { role: 'user', content: message },
  ]);
}
```

### 9. Suscribirse a todos los eventos del engine

```typescript
import { AgentEvent } from '@bk/agent-core';

const engine = createCodingEngine({ ... });

// O usar transport directo
const transport = new CallbackTransport((event: AgentEvent) => {
  switch (event.type) {
    case 'block_start':   console.log(`[${event.agentId}] iniciando...`); break;
    case 'agent_switch':  console.log(`delegando: ${event.from} → ${event.to}`); break;
    case 'token':         process.stdout.write(event.text); break;
    case 'tool_call':     console.log(`\n  tool: ${event.tool}(${JSON.stringify(event.args)})`); break;
    case 'tool_result':   console.log(`  → ${event.ok ? 'ok' : 'error'}`); break;
    case 'thinking':      console.log(`  [thinking] ${event.label}`); break;
    case 'metrics':       console.log(`tokens: ${event.total}, costo: $${event.cost}`); break;
    case 'done':          console.log('\n✓ completado'); break;
    case 'error':         console.error(`\n✗ ${event.message}`); break;
  }
});
```

### 10. Override del system prompt de un agente builtin

Para personalizar un agente builtin sin perder su configuracion base, crear solo el `.md`:

```
~/.bk-agent/agents/general.md
```

```markdown
Sos el orquestador de equipo de backend en [Mi Empresa].
Siempre que el usuario pida una feature, primero pregunta si hay tickets en Jira
relacionados antes de empezar a implementar.

Nuestras convenciones internas:
- Todas las PRs necesitan review de al menos 2 personas
- Nunca deployar los viernes
- Los nombres de branches siguen el patron: {tipo}/{ticket-id}-{descripcion}
```

### 11. Deteccion de frameworks via grafo de imports (MCP)

El servidor MCP analiza el grafo de imports para identificar frameworks especificos mas alla del lenguaje:

```
@nestjs/core              → nestjs
express                   → express
fastify                   → fastify
@prisma/client            → prisma
typeorm                   → typeorm
zod                       → zod
fastapi (Python)          → fastapi
django (Python)           → django
gin-gonic/gin (Go)        → gin
actix-web (Rust)          → actix
spring-boot (Java)        → spring
```

`skills_search` usa esta info para marcar con ✓ los skills que coinciden exactamente con el stack real del proyecto.

---

## Crear agentes personalizados

### Agente de proyecto

Visible solo en el proyecto donde esta definido:

```
mi-proyecto/.bk-agent/agents/
├── mi-agente.json
└── mi-agente.md
```

### Agente global

Disponible en todos los proyectos:

```
~/.bk-agent/agents/
├── mi-agente.json
└── mi-agente.md
```

### Scaffoldear un agente nuevo

```
> /agent new database-expert
# Crea .bk-agent/agents/database-expert.json + .md con template

> /agent new database-expert --global
# Crea ~/.bk-agent/agents/database-expert.json + .md
```

### Schema del .json

```json
{
  "id": "database-expert",
  "name": "Database Expert",
  "icon": "⊞",
  "description": "Especialista en PostgreSQL y optimizacion de queries",
  "allowedTools": ["read_file", "write_file", "edit_file", "run_command", "search_files",
                   "save_context", "save_learning", "append_log"],
  "delegatesTo": ["coder"],
  "provider": "deepseek",
  "suppressDefaultOutput": false
}
```

---

## Instalar packs externos de skills

### Via CLI

```bash
# Pack completo
npx @bk/mcp-server install https://github.com/org/skills-pack

# Un skill especifico
npx @bk/mcp-server install https://github.com/org/skills-pack --skill deploy-k8s

# Actualizar
npx @bk/mcp-server update @org/skills-pack
```

### Via MCP (desde Claude Code / Cursor)

```
Instala el pack de skills para Kubernetes desde https://github.com/org/k8s-skills
```

### Que pasa si el repositorio esta offline

Si el repositorio fuente no esta disponible, la operacion falla sin tocar el disco. Los packs ya instalados siguen funcionando — el framework los copia localmente en `~/.{appName}/skills/packs/`.

---

## Crear tu propio pack de skills

### Estructura del repositorio

```
mi-skills-pack/
├── skills/                    ← el manager busca aqui primero
│   ├── deploy-kubernetes.yaml
│   ├── terraform.yaml
│   └── datadog.yaml
└── README.md
```

### Publicar

Cualquier repositorio GitHub publico puede usarse como pack:

```bash
# Tus companeros instalan con:
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
      "env": {
        "BK_APP_NAME": "claude-code",
        "BK_CWD": "/ruta/a/tu/proyecto"
      }
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
      "env": {
        "BK_APP_NAME": "cursor",
        "BK_CWD": "${workspaceFolder}"
      }
    }
  }
}
```

### Workflow tipico desde el agente

```
Usuario: "Agregar rate limiting a los endpoints de la API"

Agente (automaticamente):
  1. stack_detect → "node, typescript, nestjs"
  2. skills_search query="rate limiting" → bk-bulkhead [ACTIVE ✓], bk-rate-limiter [ACTIVE ✓]
  3. code_context task="rate limiting endpoints API" → AppModule, Guards, Controllers
  4. Responde con el patron exacto de @backendkit-labs/bulkhead integrado al codigo del proyecto
```

---

## Librerias de resiliencia

El framework usa las librerias de BackendKit Labs para toda la capa de resiliencia.

### Patron de composicion

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
      withRetry(
        () => fetch('/api', { method: 'POST', body: JSON.stringify(payload) }),
        { maxAttempts: 3, backoff: 'exponential' }
      )
    )
  );
}
```

### `ResilientLLMClient`

Cliente HTTP para LLMs con retry + circuit breaker preconfigurados para los patrones de fallo tipicos (rate limits 429, timeouts, 5xx):

```typescript
import { ResilientLLMClient } from '@bk/agent-core';

const client = new ResilientLLMClient({
  baseUrl: 'https://api.openai.com',
  apiKey: process.env.OPENAI_API_KEY!,
  maxRetries: 3,
  circuitBreakerThreshold: 5,
});
```

---

## Estructura de datos en disco

Todo el estado se guarda en `~/.{appName}/`. El directorio del proyecto del usuario nunca se toca (excepto los archivos que el agente modifica explicitamente).

```
~/.bk-agent/                         ← o el appName que configures
│
├── config.json                      ← API keys, providers, defaultProvider
├── USER.md                          ← Perfil global del usuario (rol, estilo, preferencias)
│
├── agents/                          ← Agentes globales (todos los proyectos)
│   ├── general.md                   ← Override del system prompt del agente builtin
│   └── mi-agente-global.json + .md
│
├── skills/
│   ├── global/                      ← Skills agnnosticos (YAML)
│   ├── packs/                       ← Packs instalados via SkillManager
│   │   └── @mi-org/mi-pack/
│   └── sources.json                 ← Metadata (fuente, fecha, version)
│
├── code-index/
│   └── {cwd-hash}.db                ← SQLite: grafo de simbolos del proyecto
│
└── projects/
    └── {cwd-hash}/                  ← Estado especifico del proyecto
        ├── context.md               ← Stack, arquitectura, archivos clave
        ├── learnings.md             ← Preferencias aprendidas del usuario
        ├── log.md                   ← Actividad reciente
        ├── memory.json              ← Key-value persistente entre sesiones
        ├── skills/                  ← Skills especificos de este proyecto
        └── audits/
            ├── security-2025-05-26.md
            └── qa-engineer-2025-05-26.md
```

---

## Roadmap

### Completado

- [x] Motor multi-agente con bus de delegacion paralela (max 6 agentes por wave)
- [x] 9 agentes especializados: general, coder, backend, frontend, qa-engineer, security, architecture, infrastructure, data
- [x] InitWorkflow con 3 modos: new / existing / hybrid
- [x] ProjectStore: persistencia de context, learnings, log, audits entre sesiones
- [x] AgentLoader: carga automatica desde global y proyecto (prioridad sobre builtins)
- [x] 5 proveedores LLM: Anthropic, DeepSeek, OpenAI, Kimi, Grok
- [x] Filesystem tools: read, write, edit, list, search, run_command
- [x] Memory tools: save_context, save_learning, save_audit, append_log
- [x] Sistema de skills jerarquico (global / pack / proyecto)
- [x] Skills builtin: 5 globales + 12 de Node/TypeScript
- [x] SkillManager: install / uninstall / list / update (atomicidad garantizada)
- [x] Servidor MCP con 7 herramientas
- [x] Indexador Tree-sitter (TS, JS, Python, Go, Rust, Java) + SQLite FTS5
- [x] Grafo de llamadas caller/callee
- [x] Deteccion de 45 frameworks via grafo de imports
- [x] File watcher con re-indexacion incremental (SHA1)
- [x] Integracion BackendKit Labs (Result, Retry, CircuitBreaker, Bulkhead, Pipeline)
- [x] Slash commands: /init, /agent, /cwd, /clear, /quit
- [x] ConfigLoader con bootstrap automatico de ~/.{appName}/

### En progreso

- [ ] `agent_context` — herramienta MCP que combina code intelligence + skills en una llamada
- [ ] Panel de administracion de skills via CLI interactivo

### Planificado

- [ ] Skills con handlers TypeScript (no solo YAML estatico)
- [ ] Indexacion de Ruby, PHP, Elixir, Kotlin
- [ ] Embeddings semanticos para busqueda por significado
- [ ] Agentes autonomos con ciclo plan → execute → reflect
- [ ] `npx @bk/create-agent` para scaffolding de nuevos proyectos

---

## Contribuir

```bash
git clone https://github.com/backendkit-dev/agent-framework.git
cd agent-framework
npm install
npm run build

git checkout -b feat/mi-feature
npm run typecheck
npm test

git commit -m "feat(skills): add elixir stack detection"
```

---

## Licencia

MIT
