# agent-framework

Framework multi-agente para asistentes de codigo, construido en TypeScript con arquitectura monorepo. Disenado para ser agnnostico de LLM, agnnostico de transporte y extensible mediante un sistema jerarquico de skills.

---

## Tabla de contenidos

1. [Vision general](#vision-general)
2. [Arquitectura](#arquitectura)
3. [Instalacion](#instalacion)
4. [Packages](#packages)
5. [Sistema de Skills](#sistema-de-skills)
6. [Skills builtin](#skills-builtin)
7. [Servidor MCP](#servidor-mcp)
8. [Casos de uso basicos](#casos-de-uso-basicos)
9. [Casos de uso intermedios](#casos-de-uso-intermedios)
10. [Casos de uso avanzados](#casos-de-uso-avanzados)
11. [Instalar packs externos](#instalar-packs-externos)
12. [Crear tu propio pack de skills](#crear-tu-propio-pack-de-skills)
13. [Integracion con Claude Code / Cursor](#integracion-con-claude-code--cursor)
14. [Librerias de resiliencia](#librerias-de-resiliencia)
15. [Estructura de datos en disco](#estructura-de-datos-en-disco)
16. [Roadmap](#roadmap)

---

## Vision general

**agent-framework** resuelve tres problemas concretos al construir asistentes de codigo con LLMs:

| Problema | Solucion |
|----------|----------|
| Los agentes olvidan convenciones del proyecto | **Sistema de skills**: inyeccion dinamica en system prompt |
| Un solo agente no puede hacer todo bien | **Motor multi-agente**: orquestador + especialistas con bus de delegacion |
| Las llamadas a LLMs fallan o son lentas | **Resiliencia**: Circuit breaker, retry, bulkhead de BackendKit Labs |

El framework no impone un LLM especifico. Puede trabajar con OpenAI, Anthropic, DeepSeek o cualquier proveedor compatible con la interfaz `LLMProvider`.

---

## Arquitectura

```
agent-framework/
├── packages/
│   ├── core/          @bk/agent-core     — Motor generico, skills, orquestacion
│   ├── coding/        @bk/agent-coding   — Capa de coding: agentes, filesystem tools, LLM providers
│   └── mcp-server/    @bk/mcp-server     — Servidor MCP: code intelligence + skills via protocolo MCP
└── examples/
    └── coding-assistant/                 — REPL interactivo de ejemplo
```

### Diagrama de capas

```
┌─────────────────────────────────────────────────────────────┐
│                    Tu aplicacion / CLI                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   @bk/agent-coding                          │
│  AgentProfiles (9)  ·  FilesystemTools  ·  LLM Providers   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    @bk/agent-core                           │
│                                                             │
│   AgentEngine  ←→  DelegationBus  ←→  AgentRegistry        │
│        │                                    │               │
│   ToolRegistry        SkillSystem     ProviderRegistry      │
│        │                  │                                  │
│   Orchestrator      SkillLoader                             │
│   FSM / Policies    SkillActivator                          │
│   QAService         SkillManager                            │
│   ContextPipeline   SkillRegistry                           │
│   Reflection                                                │
│   SessionMemory                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   @bk/mcp-server                            │
│  code_search  ·  code_context  ·  code_index                │
│  skills_search  ·  skills_install  ·  skills_list           │
│  stack_detect                                               │
│  Tree-sitter (TS/JS/Python/Go/Rust/Java)  ·  SQLite FTS5   │
└─────────────────────────────────────────────────────────────┘
```

---

## Instalacion

### Requisitos

- Node.js >= 20
- npm >= 9 (workspaces)

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

## Packages

### `@bk/agent-core`

Motor generico del framework. Exporta todo lo necesario para construir agentes sin depender de ningun proveedor de LLM.

```typescript
import {
  AgentEngine,
  AgentRegistry,
  ToolRegistry,
  ProviderRegistry,
  DelegationBus,
  SessionMemory,
  SkillLoader,
  SkillManager,
  SkillActivator,
  SkillRegistry,
  GLOBAL_BUILTIN_SKILLS,
  NODE_PACK_SKILLS,
  getFrameworkDir,
  getProjectDir,
  ResilientLLMClient,
} from '@bk/agent-core';
```

### `@bk/agent-coding`

Capa especifica para asistentes de codigo. Incluye:

- **9 perfiles de agente**: orchestrator, coder, backend, frontend, QA, security, architecture, infrastructure, data
- **13 filesystem tools**: read, write, edit, search, glob, run command, etc.
- **Providers LLM**: OpenAI-compatible + Anthropic
- **ProjectStore**: persistencia de estado del proyecto en filesystem
- **InitWorkflow**: bootstrapping de proyectos

### `@bk/mcp-server`

Servidor MCP (Model Context Protocol) que expone las capacidades del framework a cualquier cliente MCP (Claude Code, Cursor, Windsurf, etc.).

---

## Sistema de Skills

Las skills son el mecanismo central del framework para inyectar conocimiento contextual en los agentes. Cuando un usuario hace una pregunta que dispara una skill, su contenido se inyecta automaticamente en el system prompt del agente activo.

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

  // Palabras clave que activan el skill cuando aparecen en el input
  triggers: string[];

  // undefined/[] = siempre activo (cualquier lenguaje)
  // ['node', 'typescript'] = solo activo si el stack coincide
  language?: string[];

  // Contenido inyectado en el system prompt cuando el skill esta activo
  systemPromptAddition?: string;

  // Scope jerarquico
  scope?: 'global' | 'pack' | 'project';

  // Para agrupar skills de un mismo pack
  pack?: string;

  // AgentIds que siempre tienen este skill activo (sin importar triggers)
  agents?: string[];

  // Herramientas adicionales que el skill aporta al agente
  tools?: SkillToolDefinition[];
}
```

### Definir una skill en YAML

Cada archivo `.yaml` en el directorio de skills define una skill:

```yaml
name: my-skill
version: 1.0.0
description: Descripcion breve del skill
scope: project
language:
  - node
  - typescript
triggers:
  - keyword1
  - keyword2
  - frase de ejemplo
systemPromptAddition: |
  ## Titulo del skill

  Cuando el usuario pida algo relacionado con este skill, seguir estas reglas:

  1. Regla uno
  2. Regla dos

  ### Ejemplo de codigo

  ```typescript
  // ejemplo aqui
  ```
```

---

## Skills builtin

### Skills globales (siempre activos, agnnosticos)

Estos skills estan disponibles para cualquier proyecto independientemente del lenguaje.

#### `conventional-commits`

**Triggers:** `commit`, `changelog`, `semver`, `release notes`

Guia al agente para escribir commits segun la convencion estandar. Incluye reglas de formato, tipos validos (feat, fix, refactor, test, docs, chore, perf, ci) y manejo de breaking changes.

```
feat(auth): add OAuth2 login via Google
fix(api): handle null response from payment provider
feat!: remove deprecated /v1 endpoints

BREAKING CHANGE: /v1/* no longer available, migrate to /v2/*
```

#### `code-review`

**Triggers:** `code review`, `pull request`, `revision`, `code quality`

Checklist estructurado de 5 dimensiones para revisiones de codigo: correctitud, legibilidad, mantenibilidad, seguridad y rendimiento. El agente siempre cita `file:line + razon`.

#### `tdd`

**Triggers:** `tdd`, `test-driven`, `red green refactor`, `coverage`

Ciclo Red → Green → Refactor. Patron AAA (Arrange/Act/Assert). Reglas sobre que testear (comportamiento observable) y que no (implementacion interna, librerias de terceros).

#### `adr`

**Triggers:** `adr`, `architecture decision`, `decision de arquitectura`

Formato de Architecture Decision Records. Guia al agente a generar ADRs con Contexto, Decision, Consecuencias y Alternativas consideradas. Los guarda en `docs/adr/`.

#### `security-checklist`

**Triggers:** `seguridad`, `security`, `owasp`, `sql injection`, `xss`, `csrf`

OWASP Top 10 simplificado: validacion de inputs, autenticacion (bcrypt/argon2), autorizacion, manejo de datos sensibles, headers HTTP, errores genericos.

---

### Skills de Node/TypeScript (`@bk-node`)

Activos automaticamente cuando el proyecto tiene `package.json` o `tsconfig.json`. Implementados sobre las librerias de BackendKit Labs.

#### `bk-result`

**Triggers:** `result monad`, `Result<T>`, `ok(`, `err(`, `error tipado`, `andThen`, `match(`

```typescript
import { ok, err, Result } from '@backendkit-labs/result';

async function findUser(id: string): Promise<Result<User, NotFoundError>> {
  const user = await db.users.findById(id);
  if (!user) return err(new NotFoundError(id));
  return ok(user);
}

const result = await findUser('123');
result.match({
  ok: user => response.json(user),
  err: error => response.status(404).json({ error: error.message }),
});
```

#### `bk-retry`

**Triggers:** `retry`, `reintentos`, `exponential backoff`, `retry storm`, `budget retry`

```typescript
import { withRetry } from '@backendkit-labs/retry';

const result = await withRetry(
  () => externalApi.call(),
  {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelayMs: 500,
    classify: (error) => error.status === 429 ? 'retryable' : 'fatal',
  }
);
```

#### `bk-circuit-breaker`

**Triggers:** `circuit breaker`, `fail fast`, `resilience`, `open circuit`, `half-open`

```typescript
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';

const cb = new CircuitBreaker({
  threshold: 5,       // fallos para abrir el circuito
  timeout: 10_000,    // ms en estado open antes de probar half-open
  isFailure: (err) => err.status >= 500,
});

const result = await cb.execute(() => service.call());
```

#### `bk-bulkhead`

**Triggers:** `bulkhead`, `concurrencia`, `throttle`, `rate limiting`, `semaforo`

```typescript
import { Bulkhead } from '@backendkit-labs/bulkhead';

const bulkhead = new Bulkhead({ maxConcurrent: 10, maxQueue: 50 });

const result = await bulkhead.execute(() => processRequest(req));
```

#### `bk-pipeline`

**Triggers:** `pipeline`, `chain of responsibility`, `middleware`, `pasos encadenados`

```typescript
import { Pipeline } from '@backendkit-labs/pipeline';

const pipeline = new Pipeline<CreateOrderInput, Order>()
  .use(validateInventory)
  .use(calculatePricing)
  .use(applyDiscounts)
  .use(persistOrder)
  .use(sendConfirmationEmail);

const result = await pipeline.run(orderInput);
result.match({ ok: order => ..., err: step => ... });
```

#### `bk-http-client`

**Triggers:** `http client`, `axios`, `llamadas http`, `api externa`, `fetch`

HTTP client con circuit breaker + retry + Result tipado ya integrados. Nunca usar axios/fetch directamente en produccion.

#### `bk-observability`

**Triggers:** `observability`, `logging`, `structured log`, `correlation id`, `metricas`

Logging estructurado con correlation ID propagado via headers y context. Incluye patron de exception handler global para NestJS.

#### `bk-request-scanner`

**Triggers:** `request scanner`, `sql injection`, `xss`, `path traversal`, `command injection`

Detector de payloads maliciosos: SQLi, XSS, Path Traversal, SSRF. Se aplica como middleware antes de cualquier procesamiento.

#### `bk-rate-limiter`

**Triggers:** `rate limiter`, `token bucket`, `sliding window`, `limite de peticiones`

Rate limiting con estrategias token bucket y sliding window. Configurable por IP, usuario o API key.

#### `bk-idempotency`

**Triggers:** `idempotency`, `idempotencia`, `duplicate request`, `mutacion duplicada`

Idempotency keys para evitar mutaciones duplicadas. Replay automatico de respuestas anteriores usando el mismo `Idempotency-Key` header.

#### `bk-auto-learning`

**Triggers:** `auto learning`, `self-tuning`, `adaptativo`, `resilience tuning`

Auto-tuning de parametros de resiliencia basado en metricas de trafico en tiempo real.

---

## Servidor MCP

El servidor MCP expone las capacidades del framework a cualquier cliente compatible con el protocolo MCP.

### Iniciar el servidor

```bash
# En el directorio del proyecto que queres indexar
BK_CWD=$(pwd) BK_APP_NAME=mi-app npx @bk/mcp-server
```

### Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `BK_APP_NAME` | `deepseek-code` | Nombre de la aplicacion (define la carpeta de datos) |
| `BK_CWD` | `process.cwd()` | Directorio del proyecto a indexar |

### Herramientas disponibles

#### `stack_detect`

Detecta el stack tecnologico del proyecto usando el indice de codigo (grafo de imports) combinado con la deteccion por archivos indicadores.

```
Respuesta: "Detected stack: node, typescript, zod, nestjs"
```

#### `skills_search`

Busca skills disponibles por query. Marca con ✓ los que coinciden con el stack del proyecto.

```
Input:  { query: "retry", cwd: "/mi-proyecto" }
Output: - **bk-retry** ✓ [pack, typescript, ACTIVE]
          Retry enterprise-grade con backoff, budget y clasificacion de errores
```

#### `skills_install`

Instala un pack de skills desde GitHub o desde un directorio local.

```
Input:  { source: "https://github.com/org/my-skills", skill: "deploy-k8s" }
Output: "Installed pack "my-skills" with 1 skill(s)."
```

#### `skills_list`

Lista todos los packs instalados incluyendo los builtin.

```
Output:
**@bk/global** (builtin)
  Skills: conventional-commits, code-review, tdd, adr, security-checklist

**@bk-node** (builtin)
  Skills: bk-result, bk-retry, bk-circuit-breaker, ...
```

#### `code_search`

Busca simbolos (funciones, clases, interfaces, tipos) en la codebase por nombre o keyword.

```
Input:  { query: "SkillManager", limit: 5 }
Output: **SkillManager** (class) — packages/core/src/skills/manager.ts:37
          export class SkillManager {
```

#### `code_context`

Dada una descripcion de tarea, retorna los simbolos mas relevantes con su codigo, callers y callees. Usa el grafo de llamadas del indice para dar contexto completo.

```
Input:  { task: "install skill from github", max_symbols: 5 }
Output:
### install (method) — manager.ts:47-89
> calledBy: main, install | calls: fetchGitHub, writeAtomic
```typescript
async install(source: string, options?: InstallOptions): Promise<void> {
  ...
}
```
```

#### `code_index`

Dispara una re-indexacion completa del proyecto. Util si el indice esta desactualizado.

```
Input:  { cwd: "/mi-proyecto" }
Output: "Indexed 247 files, 1843 new symbols.
         Total: 2891 nodes, 6234 edges across 247 files."
```

### Configurar en Cursor / Windsurf

En `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agent-framework": {
      "command": "node",
      "args": ["path/to/agent-framework/packages/mcp-server/dist/server.js"],
      "env": {
        "BK_CWD": "/ruta/a/tu/proyecto",
        "BK_APP_NAME": "mi-app"
      }
    }
  }
}
```

### Configurar en Claude Code

```json
{
  "mcpServers": {
    "bk": {
      "command": "npx",
      "args": ["@bk/mcp-server"],
      "env": {
        "BK_CWD": "${workspaceFolder}",
        "BK_APP_NAME": "mi-app"
      }
    }
  }
}
```

---

## Casos de uso basicos

### 1. Activar skills segun el input del usuario

```typescript
import {
  SkillLoader,
  SkillActivator,
  GLOBAL_BUILTIN_SKILLS,
  NODE_PACK_SKILLS,
} from '@bk/agent-core';

const loader = new SkillLoader('mi-app');
const activator = new SkillActivator();

// Cargar todas las skills disponibles
const loaded = await loader.loadAll('/ruta/al/proyecto');
const allSkills = [
  ...GLOBAL_BUILTIN_SKILLS,
  ...NODE_PACK_SKILLS,
  ...loaded.global,
  ...loaded.packs,
  ...loaded.project,
];

// Detectar el stack del proyecto
const stack = await activator.detectStack('/ruta/al/proyecto');
// → ['node', 'typescript']

// Activar skills segun el input del usuario
const input = 'como hago un commit?';
const activeSkills = activator.activate(input, allSkills, stack);
// → [Skill { name: 'conventional-commits', ... }]

// Obtener el texto a inyectar en el system prompt
const addition = activator.buildSystemPromptAddition(activeSkills);
// → "## Conventional Commits\n\nFormato obligatorio: `<type>(<scope>): <desc>`..."

// Inyectar en el system prompt
const systemPrompt = `Sos un asistente de codigo.\n\n${addition}`;
```

### 2. Listar packs instalados

```typescript
import { SkillManager } from '@bk/agent-core';

const manager = new SkillManager('mi-app');
const packs = await manager.list();

for (const pack of packs) {
  console.log(`${pack.pack} — ${pack.skills.length} skills`);
  console.log(`  Instalado: ${pack.installedAt}`);
  console.log(`  Fuente: ${pack.source}`);
}
```

### 3. Detectar el stack del proyecto

```typescript
import { SkillActivator } from '@bk/agent-core';

const activator = new SkillActivator();
const stack = await activator.detectStack('/ruta/al/proyecto');
// Node.js + TypeScript: ['node', 'typescript']
// Python:               ['python']
// Java (Maven):         ['java']
// Go:                   ['go']
// Rust:                 ['rust']
```

El detector busca archivos indicadores:
- `package.json` → `node`
- `tsconfig.json` → `typescript`
- `requirements.txt` / `pyproject.toml` → `python`
- `pom.xml` / `build.gradle` → `java`
- `Cargo.toml` → `rust`
- `go.mod` → `go`
- `composer.json` → `php`
- `Gemfile` → `ruby`
- `mix.exs` → `elixir`

---

## Casos de uso intermedios

### 4. Registrar handlers de skills personalizados

```typescript
import { SkillRegistry } from '@bk/agent-core';

const registry = new SkillRegistry();

// Registrar un handler
registry.register('my-db-query', async (args) => {
  const { query } = args as { query: string };
  const rows = await db.raw(query);
  return JSON.stringify(rows);
});

// Ejecutar desde cualquier parte del agente
const result = await registry.execute('my-db-query', { query: 'SELECT 1' });
if (result.ok) {
  console.log(result.data);
}
```

### 5. Instalar un pack de skills desde GitHub

```typescript
import { SkillManager } from '@bk/agent-core';

const manager = new SkillManager('mi-app');

// Instalar un pack completo
await manager.install('https://github.com/mi-org/mi-skills-pack');

// Instalar solo un skill especifico del pack
await manager.install('https://github.com/mi-org/mi-skills-pack', {
  skill: 'deploy-kubernetes',
});

// Actualizar un pack a la ultima version
await manager.update('@mi-org/mi-skills-pack');

// Desinstalar un pack
await manager.uninstall('@mi-org/mi-skills-pack');
```

**Garantia de atomicidad:** El SkillManager descarga todos los archivos en memoria primero. Solo escribe al disco si todos los fetches tienen exito. Si falla cualquier archivo, el disco queda sin modificar.

### 6. Instalar un pack desde un directorio local

```typescript
import { SkillManager } from '@bk/agent-core';

const manager = new SkillManager('mi-app');

// Desde ruta absoluta
await manager.install('/home/usuario/mis-skills');

// Desde ruta relativa al cwd del proceso
await manager.install('./skills/custom');
```

El manager busca archivos `.yaml` primero en la subcarpeta `skills/` del directorio, y si no encuentra, en el directorio raiz.

### 7. Skills de proyecto (especificos del repositorio)

Las skills de proyecto se guardan en `~/.{appName}/projects/{key}/skills/` y son especificas de ese directorio de trabajo. Son la capa de mayor prioridad y sobrescriben cualquier skill global con el mismo nombre.

**Caso de uso:** convenciones internas de tu equipo que no queres publicar.

```yaml
# ~/.deepseek-code/projects/abc123/skills/internal-api.yaml
name: internal-api-conventions
version: 1.0.0
description: Convenciones internas de la API REST de nuestro equipo
scope: project
triggers:
  - endpoint
  - controller
  - api rest
  - route
systemPromptAddition: |
  ## Convenciones de API de nuestro equipo

  - Todos los endpoints usan el prefijo `/api/v2/`
  - La autenticacion va siempre via header `X-Auth-Token`
  - Los errores siguen el formato `{ code, message, traceId }`
  - Nunca exponer stacktraces en produccion
  - Los IDs de recursos usan ULID, no UUID ni autoincrement
```

---

## Casos de uso avanzados

### 8. Usar el MCP server para buscar codigo

El servidor MCP indexa tu proyecto con Tree-sitter y SQLite FTS5 para busqueda en tiempo real de simbolos y contexto semantico.

```typescript
// Via cliente MCP (ejemplo con el SDK de MCP)
const result = await mcp.callTool('code_context', {
  task: 'refactorizar el sistema de autenticacion para soportar OAuth2',
  max_symbols: 10,
});

// El servidor retorna:
// - Simbolos mas relevantes para la tarea (AuthService, JwtStrategy, etc.)
// - Su codigo fuente completo
// - Que funciones llaman a cada simbolo (calledBy)
// - Que funciones llama cada simbolo (calls)
```

### 9. Deteccion de stack via grafo de imports

Ademas de detectar el stack por archivos indicadores, el servidor MCP analiza el grafo de imports para identificar frameworks especificos:

```
Imports detectados → Framework identificado
──────────────────────────────────────────
@nestjs/core              → nestjs
express                   → express
fastify                   → fastify
@fastapi/*                → fastapi
django                    → django
flask                     → flask
gin-gonic/gin             → gin
actix-web                 → actix
tokio                     → tokio
spring-boot               → spring
zod                       → zod
prisma                    → prisma
typeorm                   → typeorm
```

Esto permite que `skills_search` marque con ✓ los skills que corresponden exactamente al stack real del proyecto.

### 10. Re-indexacion automatica con file watcher

El servidor MCP inicia un watcher con chokidar que detecta cambios en archivos y re-indexa solo los archivos modificados (indexacion incremental via hash SHA1). Los archivos no modificados no se re-parsean.

```
Archivos ignorados automaticamente:
  node_modules/, dist/, build/, .git/, coverage/, .next/, out/
```

### 11. Usar code_context desde un agente

Patron tipico: el agente usa `code_context` antes de responder una pregunta tecnica para obtener el codigo relevante del proyecto real del usuario.

```typescript
// Dentro de un agente construido con @bk/agent-coding

async function handleUserMessage(message: string) {
  // 1. Obtener contexto del codigo del proyecto
  const context = await mcp.callTool('code_context', {
    task: message,
    max_symbols: 8,
  });

  // 2. Activar skills segun el input
  const stack = await mcp.callTool('stack_detect', {});
  const skills = await mcp.callTool('skills_search', { query: message });

  // 3. Construir el prompt enriquecido
  const enrichedPrompt = [
    systemPrompt,
    context.content[0].text,
    buildSkillAdditions(skills),
  ].join('\n\n---\n\n');

  // 4. Llamar al LLM con contexto completo
  return await llm.chat([
    { role: 'system', content: enrichedPrompt },
    { role: 'user', content: message },
  ]);
}
```

---

## Instalar packs externos

### Via CLI (recomendado desde agentes)

```bash
# Instalar pack completo
npx @bk/mcp-server install https://github.com/org/skills-pack

# Instalar un skill especifico
npx @bk/mcp-server install https://github.com/org/skills-pack --skill deploy-k8s

# Listar lo instalado
npx @bk/mcp-server list

# Actualizar
npx @bk/mcp-server update @org/skills-pack
```

### Via herramienta MCP (desde Cursor/Claude)

Desde el agente podes pedirle directamente:

```
Instala el pack de skills para Kubernetes desde https://github.com/org/k8s-skills
```

El agente usara la herramienta `skills_install` del servidor MCP.

### Que pasa si el repositorio esta offline

Si el repositorio fuente no esta disponible al momento de la instalacion, la operacion falla sin modificar el disco (garantia de atomicidad). Los packs ya instalados siguen funcionando porque el framework los copia localmente en `~/.{appName}/skills/packs/`. El repositorio remoto solo se necesita para instalar o actualizar.

---

## Crear tu propio pack de skills

### Estructura del repositorio

```
mi-skills-pack/
├── skills/                    ← El manager busca aqui primero
│   ├── deploy-kubernetes.yaml
│   ├── terraform-modules.yaml
│   └── datadog-setup.yaml
└── README.md
```

Si no hay carpeta `skills/`, el manager busca `.yaml` directamente en la raiz.

### Ejemplo de skill

```yaml
name: deploy-kubernetes
version: 1.0.0
description: Guia para deployar en Kubernetes usando Helm charts
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
  - pod
  - deployment
  - ingress
systemPromptAddition: |
  ## Deploy en Kubernetes

  Siempre usar Helm para gestionar deployments. Nunca aplicar manifests YAML directamente en produccion.

  ### Estructura de Helm chart

  ```
  charts/mi-servicio/
  ├── Chart.yaml
  ├── values.yaml
  ├── values.prod.yaml
  └── templates/
      ├── deployment.yaml
      ├── service.yaml
      ├── ingress.yaml
      └── _helpers.tpl
  ```

  ### Reglas obligatorias

  - `resources.requests` y `resources.limits` siempre definidos
  - `livenessProbe` y `readinessProbe` siempre configurados
  - Secrets van via `ExternalSecret` (no hardcoded en values)
  - Siempre definir `PodDisruptionBudget` para servicios criticos
  - Rolling update: `maxSurge: 1`, `maxUnavailable: 0`
```

### Publicar el pack

Cualquier repositorio GitHub publico puede ser usado como pack. Simplemente compartir la URL:

```bash
# Tus companeros instalan el pack con:
npx @bk/mcp-server install https://github.com/mi-org/mi-skills-pack
```

---

## Integracion con Claude Code / Cursor

### Claude Code

Agregar en `~/.claude/settings.json` o en `.claude/settings.json` del proyecto:

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

Una vez conectado, Claude Code puede:
- Buscar simbolos en tu proyecto: *"Busca la implementacion de SkillManager"*
- Obtener contexto para una tarea: *"Que codigo es relevante para agregar OAuth2?"*
- Buscar skills: *"Que skills tengo disponibles para Kubernetes?"*
- Instalar packs: *"Instala el pack de skills de NextJS desde github.com/org/nextjs-skills"*

### Cursor

En `.cursor/mcp.json`:

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
Usuario: "Necesito agregar rate limiting a los endpoints de la API"

Agente (automaticamente):
  1. stack_detect → "node, typescript, nestjs, express"
  2. skills_search query="rate limiting" → bk-rate-limiter [ACTIVE, ✓]
  3. code_context task="agregar rate limiting a endpoints API" → RateLimiterModule, AppModule, guards/
  4. Responde con el patron exacto de @backendkit-labs/bulkhead + codigo especifico del proyecto
```

---

## Librerias de resiliencia

El framework usa las librerias de BackendKit Labs para toda la capa de resiliencia. Estas librerias son independientes del framework y se pueden usar en cualquier proyecto Node.js.

### Patron de composicion

```typescript
import { ok, err } from '@backendkit-labs/result';
import { withRetry } from '@backendkit-labs/retry';
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';
import { Bulkhead } from '@backendkit-labs/bulkhead';

// Composicion tipica para llamadas a servicios externos:
// Bulkhead (control de concurrencia) > CircuitBreaker (fail-fast) > Retry (reintentos)

const bulkhead = new Bulkhead({ maxConcurrent: 10, maxQueue: 50 });
const cb = new CircuitBreaker({ threshold: 5, timeout: 10_000 });

async function callExternalService(payload: unknown) {
  return bulkhead.execute(() =>
    cb.execute(() =>
      withRetry(
        () => fetch('/external-api', { method: 'POST', body: JSON.stringify(payload) }),
        { maxAttempts: 3, backoff: 'exponential' }
      )
    )
  );
}
```

### `ResilientLLMClient`

`@bk/agent-core` exporta `ResilientLLMClient`, un cliente HTTP para llamadas a LLMs que ya integra retry + circuit breaker configurados para los patrones de fallo tipicos de APIs de LLMs (rate limits 429, timeouts, 5xx).

```typescript
import { ResilientLLMClient } from '@bk/agent-core';

const client = new ResilientLLMClient({
  baseUrl: 'https://api.openai.com',
  apiKey: process.env.OPENAI_API_KEY!,
  maxRetries: 3,
  circuitBreakerThreshold: 5,
});

const response = await client.post('/v1/chat/completions', { ... });
```

---

## Estructura de datos en disco

Todos los datos del framework se guardan en `~/.{appName}/`. No se toca nada dentro del directorio del proyecto del usuario.

```
~/.deepseek-code/                    ← o el appName que configures
│
├── skills/
│   ├── global/                      ← Skills agnnosticos de lenguaje (YAML)
│   │   └── my-global-skill.yaml
│   │
│   ├── packs/                       ← Packs instalados via SkillManager
│   │   ├── @bk-node/                ← builtin (Node/TypeScript)
│   │   ├── @mi-org/mi-pack/         ← GitHub pack instalado
│   │   │   ├── deploy-k8s.yaml
│   │   │   └── terraform.yaml
│   │   └── local-pack/              ← Pack local instalado
│   │
│   └── sources.json                 ← Metadata de packs (fuente, fecha, version)
│
├── code-index/
│   └── {cwd-base64hash}.db          ← SQLite con el grafo de simbolos del proyecto
│
└── projects/
    └── {project-key}/               ← Basado en hash del path del proyecto
        ├── config.json
        ├── store.json
        └── skills/                  ← Skills especificos de este proyecto
            └── team-conventions.yaml
```

### `sources.json`

```json
[
  {
    "pack": "@mi-org/k8s-skills",
    "source": "https://github.com/mi-org/k8s-skills",
    "installedAt": "2025-05-26T14:30:00.000Z",
    "version": "1.2.0"
  },
  {
    "pack": "local-internal",
    "source": "/home/usuario/internal-skills",
    "installedAt": "2025-05-20T09:00:00.000Z"
  }
]
```

---

## Roadmap

### Completado

- [x] Motor multi-agente con bus de delegacion paralela
- [x] Sistema de skills jerarquico (global / pack / proyecto)
- [x] Skills builtin: 5 globales + 12 de Node/TypeScript
- [x] SkillManager: install / uninstall / list / update (atomicidad garantizada)
- [x] Deteccion de stack por archivos indicadores (9 lenguajes)
- [x] Servidor MCP con 7 herramientas
- [x] Indexador de codigo con Tree-sitter (TypeScript, JavaScript, Python, Go, Rust, Java)
- [x] SQLite FTS5 para busqueda de simbolos con ranking BM25
- [x] Grafo de llamadas (caller/callee) en el indice
- [x] Deteccion de frameworks via grafo de imports (45 signaturas)
- [x] File watcher con re-indexacion incremental
- [x] Integracion con BackendKit Labs (Result, Retry, CircuitBreaker, Bulkhead, Pipeline)

### En progreso

- [ ] `agent_context` — Herramienta MCP que combina code intelligence + skills + ContextPipeline en una sola llamada
- [ ] Agentes especializados via `@bk/agent-coding` (coder, backend, frontend, QA, security, etc.)
- [ ] Panel de administracion de skills via CLI interactivo

### Planificado

- [ ] Soporte para skills con handlers TypeScript (no solo YAML estatico)
- [ ] Indexacion de Ruby, PHP, Elixir, Kotlin
- [ ] Embeddings semanticos para busqueda de simbolos por significado (no solo keyword)
- [ ] Agentes autonomos con ciclo plan → execute → reflect
- [ ] `npx @bk/create-agent` para scaffolding de nuevos proyectos

---

## Contribuir

```bash
# Fork y clonar
git clone https://github.com/tu-usuario/agent-framework.git
cd agent-framework
npm install
npm run build

# Crear una rama de feature
git checkout -b feat/mi-feature

# Desarrollar + testear
npm run typecheck
npm test

# Commit siguiendo conventional commits
git commit -m "feat(skills): add elixir stack detection"
```

---

## Licencia

MIT
