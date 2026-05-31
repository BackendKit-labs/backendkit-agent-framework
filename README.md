# agent-framework

Framework multi-agente para asistentes de codigo, construido en TypeScript con arquitectura monorepo. Disenado para ser agnostico de LLM, agnostico de transporte y extensible mediante un sistema jerarquico de skills.

---

## Tabla de contenidos

1. [Vision general](#vision-general)
2. [Arquitectura](#arquitectura)
3. [Instalacion](#instalacion)
4. [Construir un agente de codificacion desde cero](#construir-un-agente-de-codificacion-desde-cero)
5. [Quickstart — REPL interactivo](#quickstart--repl-interactivo)
6. [Packages](#packages)
7. [Motor de agentes — @bk/agent-coding](#motor-de-agentes--bkagent-coding)
   - [Proveedores LLM](#proveedores-llm)
   - [Seguridad integrada](#seguridad-integrada)
   - [Auto-aprendizaje entre sesiones](#auto-aprendizaje-entre-sesiones)
   - [Los 10 agentes especializados](#los-10-agentes-especializados)
   - [Prompts con modos de madurez](#prompts-con-modos-de-madurez)
   - [Orquestacion y delegacion paralela](#orquestacion-y-delegacion-paralela)
   - [Deteccion automatica de stack](#deteccion-automatica-de-stack)
   - [Herramientas de filesystem](#herramientas-de-filesystem)
   - [Herramientas de memoria y contexto](#herramientas-de-memoria-y-contexto)
   - [ProjectStore — persistencia entre sesiones](#projectstore--persistencia-entre-sesiones)
   - [AgentLoader — carga automatica de agentes](#agentloader--carga-automatica-de-agentes)
8. [Estructura de datos en disco](#estructura-de-datos-en-disco)
9. [Comando /init — inicializacion de proyectos](#comando-init--inicializacion-de-proyectos)
10. [Slash commands built-in](#slash-commands-built-in)
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
18. [Motor autonomo — nuevas APIs](#motor-autonomo--nuevas-apis)
    - [MCP Client](#mcp-client--conectar-servidores-mcp-externos)
    - [Typed Tools con Zod](#typed-tools--definetool-con-zod)
    - [Workflow Engine](#workflow-engine--flujos-deterministas)
    - [Triggers externos](#triggers-externos--createautonomousagent)
    - [Observabilidad](#observabilidad--trazas-metricas-y-presupuesto)
    - [Memory system avanzado](#memory-system-avanzado)
    - [Agent Discovery](#agent-discovery--instalar-agentes-como-paquetes)
19. [Crear agentes personalizados](#crear-agentes-personalizados)
20. [Instalar packs externos de skills](#instalar-packs-externos-de-skills)
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
| Un solo agente no puede hacer todo bien | **10 agentes especializados** orquestados por un agente general |
| Los agentes olvidan convenciones del proyecto | **Skills + ProjectStore + session.md**: contexto persistente entre sesiones |
| Las llamadas a LLMs fallan o son lentas | **Resiliencia integrada**: CircuitBreaker, Retry con backoff exponencial, Bulkhead |
| El agente puede escribir secretos o recibir inputs maliciosos | **Seguridad integrada**: secret scanner en writes, limite de input 100 KB, permisos 600 en config |

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
│  createCodingEngine()  ·  10 Agent Profiles                 │
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
│   WorkflowEngine  ·  TriggerManager  ·  ObservabilityManager│
│   MemorySystem (episodic/semantic/procedural)               │
│   MCPClientManager  ·  AgentDiscovery  ·  defineTool()      │
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

## Construir un agente de codificacion desde cero

Esta seccion muestra como crear tu propio agente de codificacion usando el framework como base — ya sea un CLI, una app de escritorio (Electron) o un servidor.

El framework resuelve toda la complejidad: orquestacion multi-agente, deteccion de stack, sistema de skills, persistencia y slash commands. Tu solo defines:
- Tu **appName** (determina donde vive la configuracion en `~/.{appName}/`)
- Los **providers LLM** que usas
- Los **agentes y skills custom** especificos de tu herramienta

### Paso 1 — Crear el proyecto

```bash
mkdir mi-coding-agent && cd mi-coding-agent
npm init -y
npm install @bk/agent-core @bk/agent-coding typescript tsx
```

### Paso 2 — Configurar providers

Crea `~/.mi-agent/config.json` (o usa env vars):

```json
{
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "deepseek":  { "apiKey": "sk-..." }
  },
  "defaultProvider": "anthropic"
}
```

O via env vars: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`.

### Paso 3 — Crear el engine

```typescript
// src/engine.ts
import { createCodingEngine } from '@bk/agent-coding';
import { CallbackTransport } from '@bk/agent-core';

export function buildEngine(cwd: string) {
    return createCodingEngine({
        providers: {
            anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
        },
        defaultProvider: 'anthropic',
        defaultAgent:    'general',      // orquestador por defecto
        workingDir:      cwd,
        appName:         'mi-agent',     // ~/.mi-agent/ para persistencia
        maxParallelAgents: 6,
        transport: new CallbackTransport(event => {
            if (event.type === 'token') process.stdout.write(event.content);
            if (event.type === 'agent_switch') console.log(`\n→ ${event.to_name}`);
            if (event.type === 'tool_call') console.log(`\n  [${event.name}]`);
        }),
    });
    // createCodingEngine automaticamente:
    // - detecta el stack del proyecto (Node, Go, Java, Kotlin, Python...)
    // - carga los 33 skills builtin (global + 5 packs de lenguaje)
    // - carga skills YAML del agente (~/.mi-agent/skills/) y del proyecto ({cwd}/.mi-agent/skills/)
    // - inyecta AGENT.md + session + stack en el contexto de todos los agentes
}
```

### Paso 4 — Agregar agentes custom (opcional)

Crea agentes especificos de tu herramienta en `~/.mi-agent/agents/` (global) o en el proyecto en `.mi-agent/agents/`:

```markdown
<!-- ~/.mi-agent/agents/devops.md -->
Sos el especialista DevOps de esta empresa. Conoces:
- El pipeline en GitHub Actions (.github/workflows/)
- El cluster Kubernetes en EKS con Helm
- Las variables de entorno en AWS Secrets Manager

Cuando configures pipelines, siempre valida con `act` antes de pushear.
```

```json
// ~/.mi-agent/agents/devops.json
{
  "id": "devops",
  "name": "DevOps",
  "icon": "⬡",
  "description": "Pipeline CI/CD, Kubernetes, AWS",
  "allowedTools": ["read_file", "write_file", "edit_file", "run_command", "search_files", "save_context"],
  "delegatesTo": ["coder"]
}
```

### Paso 5 — Agregar skills del agente (opcional)

Skills propias de tu herramienta en `~/.mi-agent/skills/global/`:

```yaml
# ~/.mi-agent/skills/global/empresa-conventions.yaml
name: empresa-conventions
version: '1.0.0'
description: Convenciones de la empresa para todos los proyectos
triggers:
  - convencion
  - convention
  - estandar
  - naming
systemPromptAddition: |
  ## Convenciones de la Empresa

  - Branches: {tipo}/{ticket-id}-{descripcion-breve}
  - PRs requieren review de al menos 2 personas
  - No deployar los viernes
  - Logs estructurados con correlation-id en todos los servicios
  - Nunca hardcodear secrets — usar AWS Secrets Manager
```

### Paso 6 — Agregar skills del proyecto

Las skills especificas del proyecto que se construye viven DENTRO del proyecto (git-tracked):

```yaml
# mi-android-app/.mi-agent/skills/kotlin-conventions.yaml
name: kotlin-conventions
version: '1.0.0'
description: Convenciones Kotlin de este proyecto Android
language:
  - kotlin
triggers:
  - coroutine
  - compose
  - room
  - hilt
systemPromptAddition: |
  ## Convenciones Kotlin de este proyecto

  - Siempre usar Hilt para DI — no Koin ni manual
  - Room acceso SOLO via repositorios — nunca directo desde ViewModel
  - StateFlow para estado UI, nunca LiveData en codigo nuevo
  - Minimo 80% cobertura en domain layer
```

### Paso 7 — Wiring del REPL con slash commands

```typescript
// src/index.ts
import * as readline from 'readline';
import { buildEngine } from './engine';
import {
    SlashCommandRegistry,
    registerBuiltinCommands,
    getProjectDir,
} from '@bk/agent-core';
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_NAME = 'mi-agent';
const cwd = process.cwd();

let engine = buildEngine(cwd);
const registry = new SlashCommandRegistry();
registerBuiltinCommands(registry);

// Comandos propios de tu agente
registry.register('/init', 'Inicializar el proyecto y generar documentacion', async (ctx) => {
    await ctx.runEngine?.('/init'); // delega al engine
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '❯ ' });
rl.prompt();

rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    const projectDir = getProjectDir(APP_NAME, cwd);
    let sessionContent = '';
    try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}

    const handled = await registry.dispatch(input, {
        emit: text => console.log(text),
        appName: APP_NAME,
        projectDir,
        sessionContent,
        runEngine: prompt => engine.run(prompt),
        injectContext: msg => console.log('[ctx]', msg),
        onCwdChange: newCwd => { engine = buildEngine(newCwd); },
    });

    if (!handled) await engine.run(input);
    rl.prompt();
});
```

### Paso 8 — /init para el primer proyecto

Cuando el usuario trabaje en un proyecto nuevo:

```bash
cd mi-proyecto-android
echo "# Mi App Android\nCrear app de finanzas personales con Kotlin + Jetpack Compose + Room" > prompt.md

# Ejecutar tu agente
node dist/index.js

❯ /init
# Detecta modo 'new' (hay prompt.md, no hay codigo)
# project-manager lee prompt.md e infiere:
#   Stack: Kotlin + Jetpack Compose + Room + Hilt + Android SDK 34
# Genera: design.md, specification.md, security.md, roadmap.md, AGENT.md
# AGENT.md.§Stack = "Kotlin + Jetpack Compose + Room + Android SDK 34"
# Todas las sesiones posteriores ya conocen el stack
```

### Flujo completo de una sesion normal (post-init)

```
Usuario: "implementa el ViewModel de la pantalla de gastos"
         │
         ▼
engine.run() — el framework automaticamente:
  1. Lazy-carga skills YAML de ~/.mi-agent/skills/ y .mi-agent/skills/
  2. Activa skills por trigger: kotlin-coroutines, compose-patterns, android-architecture
  3. Inyecta en el system prompt: AGENT.md + stack + session + skills activas
         │
         ▼
General analiza + delega:
  ask_agent("backend",   "disena el ViewModel con StateFlow + Hilt")
  ask_agent("qa-engineer", "define los tests con Turbine y MockK")
  (paralelo — DelegationBus con Bulkhead)
         │
         ▼
Cada agente recibe: su prompt especializado + AGENT.md + skills de Kotlin
Backend → plan de arquitectura
QA      → plan de tests
         │
         ▼
ask_agent("coder", plan completo)
Coder escribe los archivos en Kotlin respetando las convenciones del proyecto
```

### Estructura recomendada del agente

```
mi-coding-agent/
├── src/
│   ├── index.ts        ← REPL / entrada principal
│   └── engine.ts       ← createCodingEngine configurado
├── package.json
└── tsconfig.json

~/.mi-agent/            ← config del agente (no del proyecto)
├── config.json         ← providers y API keys
├── USER.md             ← perfil global del desarrollador
├── agents/             ← agentes custom globales
│   └── devops.json + .md
└── skills/
    └── global/         ← skills globales del agente
        └── empresa-conventions.yaml

mi-proyecto/            ← proyecto que se construye (en git)
├── .mi-agent/
│   ├── agents/         ← agentes especificos del proyecto
│   └── skills/         ← skills especificas del proyecto (git-tracked)
│       └── kotlin-conventions.yaml
├── AGENT.md            ← generado por /init (stack, commands, architecture)
├── design.md           ← generado por /init
└── ... (codigo del proyecto)
```

---



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

### Seguridad integrada

El framework incluye controles de seguridad activos por defecto — no requieren configuracion adicional.

#### Permisos de archivo en config.json

`config.json` contiene las API keys. Al crearse por primera vez, el framework aplica `chmod 600` automaticamente en sistemas POSIX (Linux/macOS). `ConfigLoader.save()` tambien re-aplica `chmod 600` despues de cada escritura, evitando que una actualizacion programatica relaje los permisos. Al leer el archivo, verifica que los permisos no sean mas permisivos y avisa con el comando correctivo si lo son.

```
[config] ⚠ ~/.bk-agent/config.json has permissions 644 — API keys are readable by others.
Fix with: chmod 600 ~/.bk-agent/config.json
```

En Windows los permisos de archivo se gestionan via ACLs del sistema operativo; la advertencia no aplica.

#### Sandbox de rutas

Todas las herramientas de filesystem (`read_file`, `write_file`, `edit_file`, `search_files`, `run_command`) resuelven las rutas contra el `workingDir` del engine y rechazan cualquier intento de acceder fuera de el. La implementacion usa comparacion de prefijo en lugar de `path.relative()`, lo que corrige correctamente rutas cross-drive (`D:\outside`) y UNC (`\\server\share`) en Windows donde `relative()` no retorna `..`.

```
Error: Access denied: "../../secrets/.env" resolves outside the working directory.
```

#### Validacion de comandos en cadena

`run_command` mantiene un allowlist de binarios autorizados. La validacion se aplica a **todos** los binarios en la cadena del comando — no solo al primero — inspeccionando cada segmento separado por `&&`, `||`, `|`, `;` y subshells `$(`. Los strings entre comillas se neutralizan antes de la inspeccion para evitar falsos positivos.

```
# Rechazado: "sh" no esta en el allowlist aunque "echo" si lo este
run_command("echo ok && sh exploit.sh")
→ Error: Command "sh" is not in the allowed list.
```

El directorio de ejecucion (`cwd`) tambien pasa por el sandbox de rutas — `cwd: "../../outside"` retorna error antes de ejecutar el comando.

#### Gate de aprobacion humana (modo manual)

Cuando `onToolApproval` esta configurado, el gate de aprobacion se aplica a **todos** los agentes — incluyendo los sub-agentes invocados via `ask_agent`. La ejecucion de tools sigue un camino unificado (`executeToolCall`) que garantiza: autorizacion por `allowedTools` → gate de aprobacion → ejecucion → audit trail. Esto cierra el caso donde el agente orquestador delega a un especialista que luego escribe archivos sin pasar por el gate.

#### Deteccion de secretos en writes

Antes de escribir o editar cualquier archivo, `write_file` y `edit_file` escanan el contenido contra 7 patrones de secretos conocidos. El warning aparece tanto en la consola del operador como en el resultado devuelto al LLM — el agente lo ve y puede informar al usuario.

Patrones detectados: Anthropic API key, OpenAI API key, AWS Access Key ID, GitHub PAT, GitLab token, bloques de clave privada (PEM), y asignaciones genericas de `password`/`secret`/`apiKey` con valores largos.

```
[SecretScanner] ⚠ Potential secret(s) detected in "config/db.ts": Generic secret value.
Verify this is intentional and never commit secrets to version control.
```

#### Limite de tamano de input

`AgentEngine.run()` rechaza inputs que excedan **100 KB** (`Buffer.byteLength`). Si el input supera el limite, el engine emite un evento `error` con el tamano real y retorna inmediatamente sin llamar al LLM. Esto previene ataques de prompt injection via payloads extremadamente grandes.

#### Limite de body en WebhookServer

`WebhookServer` rechaza requests que superen **1 MB** de body (configurable via `opts.maxBodyBytes`) con HTTP 413. Esto previene agotamiento de memoria ante requests maliciosos antes de que se procese la firma HMAC.

#### Retry con backoff exponencial en providers

`AnthropicProvider` y `OpenAICompatibleProvider` reintentan automaticamente errores 429 (rate limit) y 5xx con backoff exponencial (1s, 2s, 4s, 8s, cap en 16s). El reintento nunca ocurre si ya se emitio contenido al caller (mid-stream guard), evitando contenido duplicado.

#### Audit trail automatico

Cada tool call ejecutado se registra automaticamente en un archivo NDJSON append-only:

```
~/.{appName}/projects/{key}/audits/tool-calls.ndjson
```

Cada linea es un registro JSON con: timestamp, sessionId, agentId, nombre del tool, preview del input (≤200 chars), success, y duracion en ms. La escritura usa `appendFileSync` — garantiza el orden correcto bajo ejecucion paralela de sub-agentes.

```json
{"ts":"2026-05-29T14:30:00.000Z","session":"default","agent":"coder","tool":"write_file","input":"{\"file_path\":\"src/auth.ts\",...}","success":true,"durationMs":12}
{"ts":"2026-05-29T14:30:01.000Z","session":"default","agent":"security","tool":"read_file","input":"{\"file_path\":\"src/auth.ts\"}","success":true,"durationMs":3}
```

Para desactivar el audit trail, pasar `auditLog: undefined` al crear el engine con `createBaseEngine`.

---

### Auto-aprendizaje entre sesiones

Activando `reflection: true` en las opciones de orquestacion, cada sprint con hallazgos de auditoría alimenta un `FailureCatalog` persistente. El framework detecta patrones automaticamente y, a partir de 3 ocurrencias del mismo problema con severidad `high` o `critical`, promueve una `PolicyRule` que el Orchestrator aplica en runs futuros.

```typescript
createCodingEngine({
    providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } },
    defaultProvider: 'anthropic',
    orchestration: {
        reflection: true,   // activa con defaults — persiste en ~/.{appName}/
    },
});
```

**Ciclo completo** (ocurre automaticamente al finalizar un sprint con hallazgos):

```
agente security/qa-engineer emite hallazgos
              ↓
  AuditReporter.completeSprint()
              ↓
  FailureCatalog ← findings acumulados cross-sprint en disco
              ↓  (flushReflections)
  PatternDetector detecta failureType con ≥ 3 ocurrencias
              ↓  (solo high/critical)
  PolicyPromoter → manifest.yaml (nueva PolicyRule auto-generada)
              ↓
  LessonsMemoGenerator → lecciones-aprendidas.md (historial completo)
              ↓
  System prompt de todos los agentes — próxima sesión
```

Con control total sobre la configuración:

```typescript
import { ReflectionEngine } from '@bk/agent-core';

const re = new ReflectionEngine({
    projectRoot: process.cwd(),
    appName:     'mi-agent',
    config: {
        promotionThreshold:    2,   // promover tras 2 ocurrencias (default: 3)
        maxAutoGeneratedRules: 15,  // límite de reglas auto-generadas (default: 20)
    },
});

createCodingEngine({
    // ...
    orchestration: { reflection: re },
});
```

Los 5 dominios de fallos predefinidos (se pueden extender con dominios custom via `DomainRegistry`):

| Dominio | Qué captura |
|---------|-------------|
| `audit` | Hallazgos de security/qa/architecture: `hardcoded_secret`, `missing_test_coverage`, `security_vulnerability`, ... |
| `agent` | Comportamiento del agente: `wrong_agent_selected`, `agent_hallucination`, `delegation_failed`, ... |
| `test` | Fallos de test suite: `coverage_below_threshold`, `flaky_test`, `tsc_noEmit_type_error`, ... |
| `commit` | Problemas de commit: `test_failed_before_commit`, `branch_naming_invalid`, ... |
| `bootstrap` | Fallos de inicialización: `missing_config_yaml`, `manifest_corrupt`, ... |

Las `PolicyRule` auto-promovidas se escriben en `~/.{appName}/manifest.yaml` y el Orchestrator las aplica desde el siguiente run — sin reiniciar ni reconfigurar.

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

El **DelegationBus** permite que el agente general coordine multiples especialistas en paralelo. Cuando el agente emite varios `ask_agent` en la misma respuesta, se ejecutan concurrentemente via un `Bulkhead` que limita la concurrencia a `maxParallelAgents` (default: 6). Los slots se liberan individualmente al terminar cada agente — no hay espera de ola completa.

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
| `run_command` | Ejecuta un comando shell con timeout configurable (default 30s). Todos los binarios de la cadena deben estar en el allowlist. El `cwd` pasa por el sandbox de rutas. |

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
| *(automatico)* | Cada tool call ejecutado: agente, tool, input preview, success, duracion | `audits/tool-calls.ndjson` |

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
├── manifest.yaml                    ← PolicyRules auto-generadas por ReflectionEngine
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
        │   ├── lecciones-aprendidas.md  ← Generado por ReflectionEngine (cross-sprint)
        │   ├── tool-calls.ndjson        ← Audit trail automatico (append-only)
        │   └── failure-catalog.json     ← FailureRecords acumulados cross-sprint
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

### Skills de Go (`@bk-go`)

Activos automaticamente cuando el proyecto tiene `go.mod`.

| Skill | Triggers | Contenido |
|-------|----------|-----------|
| `go-error-handling` | error, errors, fmt.Errorf, errors.Is | Wrapping con `%w`, sentinel errors, errors.Is/As |
| `go-concurrency` | goroutine, channel, context, sync | Ciclo de vida de goroutines, select, timeout, Mutex |
| `go-http-server` | http, handler, middleware, chi, gin | Handler pattern, middleware, helpers JSON, slog |
| `go-testing` | test, testify, table driven, mock | Table-driven tests, mock via interface, testify |

### Skills de Java/Spring Boot (`@bk-java`)

Activos automaticamente cuando el proyecto tiene `pom.xml` o `build.gradle`.

| Skill | Triggers | Contenido |
|-------|----------|-----------|
| `spring-layered-architecture` | spring, controller, service, repository | Controller→Service→Repository, DTOs, @Transactional |
| `spring-exception-handling` | exception, @ControllerAdvice, ProblemDetail | Excepciones de dominio, RFC 7807, handler global |
| `spring-testing` | junit, mockito, @WebMvcTest | Unit tests, slices HTTP/JPA, AssertJ |
| `spring-jpa` | jpa, hibernate, entity, migration | Entities, Spring Data, Flyway/Liquibase |

### Skills de Kotlin/Android (`@bk-kotlin`)

Activos automaticamente cuando el proyecto tiene `build.gradle.kts` o `settings.gradle.kts`.

| Skill | Triggers | Contenido |
|-------|----------|-----------|
| `kotlin-coroutines` | coroutine, suspend, flow, StateFlow | Dispatchers, Flow, viewModelScope, manejo de errores |
| `compose-patterns` | compose, composable, remember, LaunchedEffect | State hoisting, side effects, Modifier convention |
| `android-architecture` | viewmodel, repository, hilt, room | Clean Architecture, StateFlow, Hilt modules |
| `kotlin-testing` | mockk, turbine, runTest | MockK, Turbine para Flow, MainCoroutineRule |

### Skills de Python/FastAPI (`@bk-python`)

Activos automaticamente cuando el proyecto tiene `requirements.txt` o `pyproject.toml`.

| Skill | Triggers | Contenido |
|-------|----------|-----------|
| `fastapi-patterns` | fastapi, router, depends, pydantic | APIRouter, Depends, schemas separados, async handlers |
| `python-error-handling` | exception, httpexception, raise | Excepciones de dominio, handler global, logging |
| `sqlalchemy-patterns` | sqlalchemy, orm, alembic, repository | Async SQLAlchemy, repository pattern, migraciones |
| `python-testing` | pytest, fixture, httpx, asyncclient | pytest-asyncio, AsyncMock, httpx AsyncClient |

### Total de skills builtin: 33

```
5  globales (cualquier stack)
12 @bk-node (Node/TypeScript)
4  @bk-go (Go)
4  @bk-java (Java/Spring)
4  @bk-kotlin (Kotlin/Android)
4  @bk-python (Python/FastAPI)
```

Solo las skills cuyos **triggers coinciden con el input** Y cuyo **language coincide con el stack detectado** se inyectan en el prompt — sin bloat.

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

## Motor autonomo — nuevas APIs

Las siguientes APIs del package `@bk/agent-core` convierten el engine en un sistema de agentes verdaderamente autonomo: actua sobre eventos externos, ejecuta flujos deterministas, mide costos y recuerda lo que aprendio.

---

### MCP Client — conectar servidores MCP externos

Conecta cualquier servidor MCP al engine. Las tools se descubren automaticamente en el primer `run()` y quedan disponibles para todos los agentes.

```typescript
import { createBaseEngine } from '@bk/agent-core';

const engine = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [myAgent],

  mcpServers: [
    {
      name: 'github',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
    },
    {
      name: 'postgres',
      command: 'npx',
      args: ['@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: process.env.DATABASE_URL },
      timeoutMs: 10_000,
    },
  ],
});

// Los agentes pueden llamar a "mcp__github__create_pull_request",
// "mcp__postgres__query", etc. — sin codigo adicional
await engine.run('Abri una PR con los cambios del dia');
```

---

### Typed Tools — defineTool() con Zod

Define tools con type safety completo. El schema JSON para el LLM se genera automaticamente desde Zod; los argumentos se validan en runtime antes de llegar al handler.

```typescript
import { defineTool, z, createBaseEngine } from '@bk/agent-core';

const searchTool = defineTool({
  name: 'search_codebase',
  description: 'Busca simbolos en el codebase por nombre o keyword',
  input: z.object({
    query:   z.string().describe('Termino de busqueda'),
    limit:   z.number().int().min(1).max(50).default(10),
    kind:    z.enum(['function', 'class', 'type', 'any']).default('any'),
  }),
  execute: async ({ query, limit, kind }, ctx) => {
    // query, limit, kind estan completamente tipados
    const results = await myIndex.search(query, { limit, kind });
    return results.map(r => `${r.kind} ${r.name} — ${r.file}:${r.line}`).join('\n');
  },
});

const engine = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [myAgent],
  tools: [searchTool],
});
```

**Errores de validacion** se devuelven como strings al LLM (no se lanzan excepciones), permitiendole corregir sus argumentos en la siguiente iteracion.

---

### Workflow Engine — flujos deterministas

Ejecuta secuencias de agentes como codigo, no como decision del LLM. Los steps sin dependencias compartidas corren en paralelo; `requireApproval` pausa el flujo para aprobacion humana.

```typescript
import { workflow, agent, createBaseEngine } from '@bk/agent-core';

const releaseWorkflow = workflow('release-pipeline')
  .step('security-audit', agent('security'), {
    input: 'Audita el diff actual para vulnerabilidades P0 y P1',
  })
  .step('qa-review', agent('qa-engineer'), {
    input: 'Revisa los cambios staged y emite GO / NO-GO',
  })
  .step('deploy-staging', agent('infrastructure'), {
    input: 'Deploya a staging via GitHub Actions',
    dependsOn: ['security-audit', 'qa-review'],  // espera a que ambos terminen
  })
  .step('smoke-tests', agent('qa-engineer'), {
    input: 'Ejecuta smoke tests en staging y reporta resultados',
    dependsOn: ['deploy-staging'],
  })
  .step('deploy-prod', agent('infrastructure'), {
    input: 'Deploya a produccion',
    dependsOn: ['smoke-tests'],
    requireApproval: true,  // pausa — el humano aprueba o rechaza
  });

const engine = createBaseEngine({ ... });

const result = await engine.runWorkflow(releaseWorkflow, {
  onApprovalRequired: async (step, prevOutputs) => {
    console.log(`\nAprobacion requerida para: ${step.id}`);
    console.log('Resultado de smoke tests:\n', prevOutputs['smoke-tests']);
    const answer = await readline.question('Deployar a produccion? (s/n): ');
    return answer.toLowerCase() === 's';
  },
});

console.log('Estado:', result.status); // 'completed' | 'failed' | 'rejected'
for (const [id, step] of Object.entries(result.steps)) {
  console.log(`  ${id}: ${step.status}`);
}
```

Los outputs de los steps anteriores se pasan automaticamente como contexto a los steps dependientes — el agente de `deploy-staging` recibe los reportes de `security-audit` y `qa-review`.

---

### Triggers externos — createAutonomousAgent()

Crea un agente que se activa solo ante eventos externos — sin que ningun humano tenga que llamar a `engine.run()`.

```typescript
import { createAutonomousAgent, EventBus } from '@bk/agent-core';

const agent = createAutonomousAgent({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [monitorAgent],
  workingDir: process.cwd(),

  goal: 'Monitorear PRs, detectar problemas de seguridad y notificar en Slack',

  triggers: [
    // Webhook: recibe notificaciones de GitHub
    {
      type: 'webhook',
      path: '/github/pr',
      secret: process.env.GITHUB_WEBHOOK_SECRET,
      buildPrompt: (body, headers) =>
        `Nueva PR abierta: ${(body as any).pull_request.title}\nURL: ${(body as any).pull_request.html_url}`,
    },

    // Schedule: digest diario de seguridad
    {
      type: 'schedule',
      cron: '0 9 * * 1-5',           // lunes a viernes a las 9:00
      task: 'Genera el resumen de seguridad del dia para el equipo',
      timezone: 'America/Argentina/Buenos_Aires',
    },

    // Event: reacciona a eventos internos
    {
      type: 'event',
      topic: 'ci.failed',
      source: 'github-actions',       // solo eventos de esta fuente
      buildPrompt: (payload) =>
        `CI fallo en: ${JSON.stringify(payload)}. Analiza la causa y notifica.`,
    },
  ],

  webhookPort: 3001,
});

await agent.start();
console.log('Agente autonomo activo');

// Otros servicios pueden disparar el agente via EventBus:
EventBus.emit('ci.failed', { source: 'github-actions', data: { repo: 'my-api', branch: 'main' } });

// O directamente:
agent.emit('ci.failed', { repo: 'my-api', branch: 'main' }, 'github-actions');

process.on('SIGTERM', () => agent.stop());
```

El agente serializa las activaciones — si llega un trigger mientras hay un run en curso, lo descarta con un warning en lugar de crear una race condition.

---

### Observabilidad — trazas, metricas y presupuesto

Wrappea el transport transparentemente. No requiere cambios al engine ni a los agentes existentes.

```typescript
import { createBaseEngine, MODEL_PRICING } from '@bk/agent-core';

const engine = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [myAgent],

  observability: {
    // Trazas: span por run y por agent_block
    tracing: {
      exporter: 'console',    // 'console' | 'noop' | (span) => void
      // Para Jaeger: exporter: (span) => fetch('http://jaeger:14268/api/traces', { ... })
    },

    // Metricas en memoria, snapshot despues de cada run
    metrics: {
      onSnapshot: (snapshot) => {
        console.log(`runs: ${snapshot.runs.total}, p95: ${snapshot.runs.p95Ms}ms`);
        console.log(`tokens: ${snapshot.tokens.totalInput}in / ${snapshot.tokens.totalOutput}out`);
        console.log(`costo estimado: $${snapshot.tokens.estimatedCostUsd.toFixed(4)}`);
      },
    },

    // Presupuesto de costos
    costTracker: {
      ...MODEL_PRICING['claude-sonnet-4-6'],  // { inputPricePerMToken: 3, outputPricePerMToken: 15 }
      budget: {
        perRun: 0.50,    // USD maximo por run individual
        perDay: 10.00,   // USD maximo acumulado por dia (reset a medianoche UTC)
      },
      onBudgetExceeded: (usage) => {
        console.warn(`Presupuesto excedido (${usage.budgetExceeded}):`, usage);
        engine.abort();   // detiene el run actual en la proxima iteracion
      },
    },
  },
});

await engine.run('Refactoriza el modulo de autenticacion');

// Acceder a metricas en cualquier momento:
const snapshot = engine.observability?.getMetricsSnapshot();
const runCost  = engine.observability?.getRunCost();   // costo del ultimo run
const dayCost  = engine.observability?.getDayCost();   // acumulado del dia
```

**Precios disponibles en `MODEL_PRICING`:**

| Modelo | Input ($/Mtok) | Output ($/Mtok) |
|--------|---------------|----------------|
| `claude-opus-4-8` | 15 | 75 |
| `claude-sonnet-4-6` | 3 | 15 |
| `claude-haiku-4-5` | 0.80 | 4 |
| `gpt-4o` | 5 | 15 |
| `gpt-4o-mini` | 0.15 | 0.60 |
| `deepseek-chat` | 0.27 | 1.10 |

---

### Memory system avanzado

Tres tiers de memoria persistente. Los agentes la usan a traves de 5 tools registrados automaticamente (`memory_remember`, `memory_recall`, `memory_save_knowledge`, `memory_search_knowledge`, `memory_learn_pattern`).

```typescript
import { createBaseEngine, createMemorySystem } from '@bk/agent-core';

const memory = createMemorySystem({
  // Episodica: log de experiencias con busqueda por keywords
  episodic: {
    provider: 'json',
    path: '~/.my-agent/memory/episodes.json',
  },

  // Semantica: knowledge base con busqueda vectorial opcional
  semantic: {
    provider: 'json',
    path: '~/.my-agent/memory/knowledge.json',
    // embedFn: async (text) => await myEmbeddingAPI.embed(text),
    // Si no se provee embedFn, usa keyword scoring en su lugar
  },

  // Retension: evita que la memoria crezca sin limite
  retention: {
    maxEpisodes: 1000,
    summarizeAfter: 100,  // cada 100 episodios, llama a summarizeFn
    summarizeFn: async (episodes) => {
      const response = await engine.run(`Resume estos episodios en 3 bullets: ${JSON.stringify(episodes)}`);
      return response;
    },
  },
});

const engine = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [myAgent],
  memorySystem: memory,
  // Los tools de memoria se registran automaticamente
  // El context block se inyecta en cada system prompt
});

// Los agentes usan los tools en sus respuestas:
// memory_remember("Deploy a produccion fallido por OOM en worker-3", ["deploy", "error", "prod"])
// memory_recall("fallo en produccion")    → episodios relevantes
// memory_learn_pattern("timeout en DB", "aumentar pool size", "success")

// Uso programatico:
memory.episodic.remember('PR #234 mergueada sin review de security', ['pr', 'audit']);
const episodes = memory.episodic.recall('error en deploy', 5);
const knowledge = await memory.semantic.search('mejores practicas retry');
memory.procedural.learnPattern('CI falla en tests de integracion', 'correr `docker compose up -d` antes', 'success');

// Contexto combinado de los 3 tiers para inyectar en un prompt:
const context = await memory.buildContextBlock('deploy a produccion');
// Devuelve markdown con: episodios relevantes + knowledge + patrones aprendidos
```

**Sin configurar `embedFn`**, la busqueda usa keyword overlap — util para la mayoria de los casos. Con `embedFn`, activa cosine similarity sobre los embeddings almacenados, compatible con cualquier proveedor (OpenAI, Cohere, local via `transformers.js`).

---

### Agent Discovery — instalar agentes como paquetes

Carga agentes desde directorios locales o un registry remoto. Los agentes descubiertos se registran en el primer `run()` — `createBaseEngine` sigue siendo sincrono.

#### Agentes locales (YAML)

Crea un archivo `agent.yaml` en `~/.bk-agent/agents/` (global) o en `.bk-agent/agents/` del proyecto (git-tracked):

```yaml
# ~/.bk-agent/agents/devops-aws/agent.yaml
id: devops-aws
name: DevOps AWS
icon: ☁️
description: Gestiona infraestructura AWS — ECS, Lambda, RDS, Secrets Manager
systemPrompt: |
  Sos el especialista DevOps de AWS de este equipo.
  Conoces el cluster ECS en us-east-1, las lambdas de procesamiento
  y las conexiones a RDS via Secrets Manager.

  Cuando configures infraestructura, siempre usa Terraform.
  Nunca hardcodees credenciales — usa aws secretsmanager get-secret-value.
allowedTools:
  - read_file
  - write_file
  - run_command
delegatesTo:
  - coder
```

#### Registry remoto

```typescript
import { createBaseEngine, discoverAgents } from '@bk/agent-core';

// Opcion A: via createBaseEngine (lazy, primer run)
const engine = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [generalAgent],   // agentes estaticos siguen funcionando

  agentDiscovery: {
    appName: 'my-app',
    local: true,             // carga ~/.my-app/agents/ y .my-app/agents/
    remote: 'https://registry.backendkit.dev/agents',
    install: [
      '@bk/agent-devops-aws',
      '@bk/agent-mobile-android',
    ],
    // Los paquetes se cachean en ~/.my-app/agents/registry/
    // Las re-ejecuciones usan el cache — sin descarga redundante
  },
});

// Opcion B: pre-cargar antes de crear el engine
const discovered = await discoverAgents({
  appName: 'my-app',
  local: true,
  install: ['@bk/agent-devops-aws'],
  remote: 'https://registry.backendkit.dev/agents',
});

const engine2 = createBaseEngine({
  providers: { claude: new AnthropicProvider(API_KEY) },
  defaultProvider: 'claude',
  agents: [...staticAgents, ...discovered],  // merge manual
});
```

**Formato del registry remoto** (para hostear tu propio registry):

```json
{
  "version": "1",
  "agents": [
    {
      "name": "@bk/agent-devops-aws",
      "version": "1.2.0",
      "description": "DevOps AWS — ECS, Lambda, RDS, Terraform",
      "downloadUrl": "https://cdn.registry.backendkit.dev/agents/@bk/agent-devops-aws@1.2.0.yaml"
    }
  ]
}
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

### Completado en v0.8.0

- [x] **Sandbox de rutas Windows**: `path-sandbox` usa prefix-check en lugar de `path.relative()` — corrige escape via rutas cross-drive (`D:\outside`) y UNC (`\\server\share`)
- [x] **Validacion de cadenas en run_command**: todos los binarios separados por `&&`, `|`, `;`, `$()` se validan contra el allowlist — cierra bypass de allowlist via shell chaining
- [x] **Sandbox de cwd en run_command**: el parametro `cwd`/`cd` pasa por `resolveAndCheck` antes de ejecutar
- [x] **Normalizacion Windows limitada al binario**: los remapeos `ls→dir`, `cat→type`, etc. solo afectan al binario inicial, nunca a los argumentos que le siguen
- [x] **Gate de aprobacion unificado**: `executeToolCall` centraliza autorizacion + `onToolApproval` + audit — cubre sub-agentes invocados via `ask_agent`, no solo el agente orquestador
- [x] **run_command fuera de READ_ONLY_TOOLS**: separacion explicita entre `READ_ONLY_TOOLS` (filesystem + memoria), `EXEC_TOOLS` (+ run_command) y `WRITE_TOOLS` (+ write_file/edit_file)
- [x] **ConfigLoader.save() aplica chmod 600**: los permisos del archivo de configuracion se mantienen tras cada escritura programatica en POSIX
- [x] **WebhookServer: limite de body 1 MB**: rechaza con HTTP 413 antes de procesar la firma HMAC — previene agotamiento de memoria
- [x] **MCP safeName consistente**: `registerMCPAgent` usa el nombre saneado como agent id, garantizando que `mcp__{safeName}__{tool}` siempre resuelva correctamente
- [x] **MCP registro independiente del tope de reintentos**: servidores que arrancan tarde se registran automaticamente en cualquier run, sin estar bloqueados por el contador de intentos
- [x] **Tokens de sub-agentes reales**: `runAgentInternal` acumula y retorna los tokens reales en `DelegationResult` en lugar de `0/0`
- [x] **Audit trail con `appendFileSync`**: orden garantizado bajo concurrencia paralela de sub-agentes
- [x] **warnIfSecrets visible en el LLM**: el warning de secretos detectados se propaga al resultado del tool — el agente lo ve y puede informar al usuario
- [x] **qa-orchestrator parametrizado**: `defaultAgentId` y `qaAgentId` se inyectan desde el engine — el core ya no depende de los IDs de string del paquete `coding`
- [x] **parentMessages eliminado de DelegationBus**: campo muerto que quedaba obsoleto tras `trimHistory()`
- [x] **applyQaDecision**: helper compartido elimina duplicacion FSM+completeSprint entre `processQaEngineerResponse` y `processInlineQaReview`

### Completado en v0.7.0

- [x] **ReflectionEngine wiring en createCodingEngine**: `OrchestrationOptions.reflection` (boolean | ReflectionEngine) conecta automáticamente el `AuditReporter` al `ReflectionEngine`
- [x] **Ciclo de auto-aprendizaje cerrado**: `AuditReflectionBridge.reportFindings()` ahora ejecuta el pipeline completo — `flushReflections()` → `PatternDetector` → `PolicyPromoter` → `LessonsMemoGenerator.persist()` — en lugar de solo alimentar el catálogo
- [x] **PolicyRules auto-promovidas**: patrones con ≥3 ocurrencias de severity `high`/`critical` se escriben en `manifest.yaml` y el Orchestrator los aplica desde el siguiente run
- [x] **lecciones-aprendidas.md cross-sprint**: `LessonsMemoGenerator` reemplaza el memo por sprint de `AuditLessonsLearned` con historial acumulado, checklists derivados de patrones reales y tabla de reglas promovidas

### Completado en v0.6.0

- [x] **Permisos 600 en config.json**: `ConfigLoader._bootstrap()` aplica `chmod 600` al crear el archivo en sistemas POSIX; `load()` verifica permisos existentes y emite warning si son mas permisivos
- [x] **Secret scanner en writes**: `warnIfSecrets()` integrado en `write_file` y `edit_file` — 7 patrones (Anthropic/OpenAI/AWS/GitHub/GitLab keys, bloques PEM, asignaciones genericas de secretos)
- [x] **Input limit 100 KB**: `AgentEngine.run()` rechaza inputs que superen el limite con evento `error` + `done`, sin llegar al LLM
- [x] **Retry con backoff exponencial**: `AnthropicProvider` y `OpenAICompatibleProvider` reintentan errores 429/5xx con backoff 1s→2s→4s→8s (cap 16s); mid-stream guard evita reintento si ya se emitio contenido
- [x] **Token counting real**: `AnthropicProvider` lee `message_start`/`message_delta` del stream; `OpenAICompatibleProvider` usa `stream_options: { include_usage: true }`; ambos llaman `onMetrics(input, output)` para el cost tracker
- [x] **Audit trail automatico NDJSON**: cada tool call ejecutado se registra en `audits/tool-calls.ndjson` — ts, session, agent, tool, input preview, success, durationMs; fire-and-forget, sin impacto en latencia
- [x] **Fix multi-system messages**: `toAnthropicMessages()` colapsa multiples mensajes `role: 'system'` en un unico parametro `system` — previene errores de API cuando el contexto incluia varios system messages
- [x] **Fix StdoutTransport listener leak**: interfaz `readline` singleton; `onInput()` reutiliza la instancia existente en lugar de crear una nueva en cada llamada; `close()` la destruye limpiamente

### Completado en v0.5.0

- [x] **MCP Client**: `createBaseEngine({ mcpServers })` — conecta servidores MCP externos; tools descubiertas automaticamente en el primer `run()`; namespace `mcp:{name}:{tool}`; timeout configurable por servidor
- [x] **Typed Tools con Zod**: `defineTool()` — schema JSON generado desde Zod, validacion en runtime, args tipados en el handler
- [x] **Workflow Engine**: `workflow().step().step()...` + `engine.runWorkflow()` — DAG de agents con dependencias, paralelismo automatico, `requireApproval` para gates humanos, outputs de steps anteriores pasados como contexto
- [x] **Triggers externos**: `createAutonomousAgent({ triggers })` — schedule (cron via node-cron), webhook (HTTP con HMAC-SHA256), event (EventBus pub/sub global); serializacion de concurrencia incluida
- [x] **Observabilidad**: `createBaseEngine({ observability })` — tracing por spans (run + agent_block), metricas en memoria (latencia p50/p95/p99, tokens, tool calls), cost tracker con presupuesto por run y por dia; wrapper transparente sobre el transport
- [x] **Memory system avanzado**: `createMemorySystem()` — episodica (keyword search + retencion configurable), semantica (keyword o cosine similarity con `embedFn`), procedimental (patrones aprendidos de exitos/fallos); 5 tools auto-registrados, context block inyectado en system prompt
- [x] **Agent Discovery**: `discoverAgents()` + `createBaseEngine({ agentDiscovery })` — carga YAML local desde `~/.{appName}/agents/` y `.{appName}/agents/`; descarga y cachea paquetes de un registry remoto; integracion lazy en el engine

### Completado en v0.4.0

- [x] **Skills cableadas al engine**: `SkillLoader` + `SkillActivator` integrados en `createCodingEngine` y `AgentEngine` — las 33 skills builtin ahora llegan al LLM por primera vez
- [x] **Activacion por trigger + stack**: cada `engine.run(input)` activa solo las skills cuyos triggers matchean el input Y cuyo language coincide con el stack detectado — sin bloat de prompt
- [x] **Lazy-loading de YAML**: skills de disco (global + packs instalados + proyecto) se cargan async en el primer `run()` — `createCodingEngine` sigue siendo sincrono
- [x] **Skills de proyecto en el proyecto**: `SkillLoader.loadProject()` ahora lee de `{cwd}/.{appName}/skills/` (git-tracked, compartible con el equipo) en lugar de `~/.{appName}/projects/{key}/skills/`
- [x] **4 nuevos packs de skills**: Go (`@bk-go`), Java/Spring (`@bk-java`), Kotlin/Android (`@bk-kotlin`), Python/FastAPI (`@bk-python`) — 16 skills de lenguaje nuevas
- [x] **Deteccion de Kotlin**: `build.gradle.kts` y `settings.gradle.kts` detectados como stack `kotlin` (diferenciado de `java`)
- [x] **Seccion "Construir un agente desde cero"**: guia completa paso a paso para crear un coding agent con el framework

### Completado en v0.3.0

- [x] **10 agentes**: agente `project-manager` builtin — coordinador dedicado del workflow `/init`
- [x] **Prompts enriquecidos**: todos los agentes con modos de madurez (Prototype/Beta/Production), checklists accionables por dominio, tablas de severidad, self-audit y formatos de respuesta obligatorios
- [x] **Veredictos GO/NO-GO**: Security, QA e Infrastructure emiten dictamen formal con plan de remediacion (Inmediato / Corto / Medio plazo)
- [x] **Deteccion automatica de stack**: `detectProjectStack()` chequea indicadores al arrancar e inyecta el stack en el contexto de todos los agentes
- [x] **Contexto universal**: `AgentEngine.buildSystemPrompt` inyecta `projectContext` en todos los agentes (no solo el orquestador)

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
