# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.12.0] — 2026-05-30

### Fixed

**MCP servers offline — falla silenciosa e imposibilidad de reintentar (`@bk/agent-core`)**

Cuando los servidores MCP están caídos, `MCPClientManager.connectAll()` usa `Promise.allSettled` — las fallas individuales se engullen, `initialize()` nunca lanza, y el catch de `ensureMCPInitialized()` nunca se ejecuta. El resultado: 0 tools registradas, `mcpInitialized = true`, y el agente nunca reintenta.

- `AgentEngine.ensureMCPInitialized()` — ya no setea `mcpInitialized = true` cuando `getTools()` retorna vacío; en su lugar emite un evento `system warn` con los nombres de los servidores offline y el número de intento
- `mcpInitAttempts` — contador privado; después de 3 intentos fallidos setea `mcpInitialized = true` para dejar de reintentar
- El warning visible al usuario: `MCP: no tools registered — git-analyst, code-explainer may be offline. Start the servers and retry (attempt N/3).`
- Si los servidores se levantan durante la sesión, en el siguiente `run()` se reintenta automáticamente sin reiniciar el coding-assistant
- `MCPClientManager.getConfiguredNames()` — nuevo método que retorna los nombres de todos los servidores configurados (conectados o no); necesario para el mensaje de warning antes de que haya conexión establecida

---

## [0.11.0] — 2026-05-30

### Fixed

**LLM prefería herramientas locales sobre MCP remotas**

El motor elegía `run_command git log` en lugar de `mcp:git-analyst:git_summarize` porque no tenía instrucción explícita de preferir las tools remotas, y las locales son más familiares para el modelo.

- `createCodingEngineFromConfig` (`@bk/agent-coding`) — cuando hay `mcpServers` configurados, inyecta un bloque `## Remote Agent Tools (MCP)` en `projectContext`; el bloque lista los servidores remotos disponibles e instruye al LLM con `ALWAYS prefer their tools over run_command or read_file when the task matches`; se propaga al system prompt de todos los agentes (general, coder, backend, etc.)
- `examples/git-analyst` — descripciones de las 3 tools actualizadas con prefijo `PREFER this over run_command` y cláusula explícita `Use when asked to...`
- `examples/code-explainer` — ídem para las 3 tools

**`AgentMCPServer` — Ctrl+C no cerraba el proceso (`@bk/mcp-server`)**

`httpServer.close()` espera que todas las conexiones existentes terminen, pero las sesiones MCP mantienen streams SSE de keep-alive indefinidamente.

- `AgentMCPServer.stop()` — llama `closeAllConnections()` (Node 18.2+) antes de `close()` para forzar el cierre inmediato de todos los sockets
- `examples/git-analyst` y `examples/code-explainer` — handler SIGINT actualizado: emite log de shutdown, timeout de 1 segundo como fuerza de salida, y llama `server.stop()`

**`examples/git-analyst` — `cd` rechazado por la allowlist de `run_command`**

El prompt generaba `cd /ruta && git log`, pero `cd` es un builtin de shell y no existe en la allowlist de binarios permitidos.

- Prompts de `git_summarize` y `git_release_notes` cambiados a `git -C "<dir>"` que ejecuta git directamente en el directorio sin necesitar `cd`

### Added

- `AgentMCPServer` — log a stderr al recibir y completar cada tool call: `[nombre] ← tool_name {args_preview}` y `[nombre] → tool_name {ms}ms`; permite verificar visualmente que el agente remoto está respondiendo

---

## [0.10.0] — 2026-05-30

### Added

**`AgentMCPServer` — exponer cualquier agente como servicio MCP (`@bk/mcp-server`)**

- `AgentMCPServer` — nueva clase que envuelve un `AgentEngine` como servidor MCP completo; exportada desde `@bk/mcp-server` (entrada principal del paquete ahora es `dist/index.js`)
- `AgentEngineFactory` — tipo `(transport: CallbackTransport) => AgentEngine`; invocado una vez por tool call para aislar estado de ejecución y capturar el output del agente
- `AgentToolDef<S>` — interfaz con `name`, `description`, `schema` (Zod), y `buildPrompt(args) → string`
- `AgentMCPServer.start()` — HTTP con `StreamableHTTPServerTransport` estático (misma lógica de sesiones que el server base)
- `AgentMCPServer.startStdio()` — modo stdio para clientes subprocess
- `AgentMCPServer.stop()` — shutdown graceful del servidor HTTP
- `runWithEngine(prompt)` — crea un `CallbackTransport` por llamada, acumula eventos `token`, resuelve en `done`, rechaza en `error`
- `@bk/mcp-server/package.json` — `main` y `types` actualizados a `dist/index.js` / `dist/index.d.ts`

**`examples/git-analyst`** (puerto 3010)

- `git_summarize` — ejecuta `git log` y resume commits agrupados por feature/fix/chore
- `git_diff_review` — revisa un diff provisto, detecta bugs, security issues y missing tests
- `git_release_notes` — genera release notes en markdown desde un tag o los últimos 30 commits

**`examples/code-explainer`** (puerto 3011)

- `explain` — explica código en inglés plain, sin jerga técnica
- `review` — revisa código por secciones: Bugs / Security / Performance / Suggestions
- `add_docstrings` — agrega comentarios de documentación (JSDoc, Google, Sphinx) y devuelve solo el código documentado

### Changed

- Ambos ejemplos se conectan al `coding-assistant` vía `mcpServers` en `config.json`, exponiendo 6 tools remotas bajo `mcp:git-analyst:*` y `mcp:code-explainer:*`

### Fixed (tsconfig)

- `"ignoreDeprecations": "5.0"` en los 6 tsconfigs suprime el warning `moduleResolution=node10 is deprecated` durante la compilación con `tsc`
- `"types": ["node"]` agregado explícitamente a todos los tsconfigs; `"jest"` incluido en `packages/core` y `packages/coding` que tienen suites de tests
- `.vscode/settings.json` — apunta el language server de VS Code a `node_modules/typescript/lib` (TS 5.9.3) para que el IDE use el mismo compiler que `tsc` y no muestre warnings de versiones bundled

---

## [0.9.0] — 2026-05-30

### Added

**`@bk/mcp-server` — modo HTTP (`--http --port=N`)**

- `buildServer()` — factory que crea un `McpServer` fresco con todas las tools registradas; reemplaza el singleton global; necesario para aislar el estado de protocolo por sesión
- `registerTools(srv)` — registra los 7 tools (`stack_detect`, `skills_search`, `skills_install`, `skills_list`, `code_search`, `code_context`, `code_index`) sobre cualquier instancia de `McpServer`
- `startHttp()` — inicia un servidor HTTP Node.js nativo usando `StreamableHTTPServerTransport` en modo **stateful** (session UUID via `randomUUID()`); gestiona un `Map<sessionId, transport>` por proceso
- Sessions almacenadas **después** de `handleRequest()` para garantizar que el UUID ya esté asignado cuando llegan requests subsiguientes; `transport.onclose` las elimina al desconectar
- `parseBody()` — helper interno que lee el cuerpo del POST antes de pasarlo a `handleRequest()`; evita que el transport trate de leer un stream ya consumido
- `startStdio()` — modo original inalterado; sigue siendo el modo por defecto si no se pasa `--http`
- CLI args: `--http` activa el modo HTTP; `--port=N` / `--port N` configuran el puerto (default `3001`); ambos compatibles con el arg existente `BK_CWD` / `BK_APP_NAME` vía env vars

**`@bk/agent-coding` — dependencia de `@bk/mcp-server`**

- `@bk/mcp-server` ahora depende de `@bk/agent-coding` para importar `GLOBAL_BUILTIN_SKILLS` y `NODE_PACK_SKILLS` (movidos a ese paquete en v0.5.0); `tools/skills/list.ts` y `tools/skills/search.ts` actualizados

### Usage

```bash
# Modo HTTP — deployable como servicio remoto
node packages/mcp-server/dist/server.js --http --port=3002

# Config en ~/.coding-assistant/config.json
{ "mcpServers": [{ "name": "bk-remote", "url": "http://127.0.0.1:3002/mcp" }] }

# /mcp tools → 7 tools [bk-remote]  streamable-http
```

---

## [0.8.0] — 2026-05-30

### Added

**MCP remote transport — StreamableHTTP + SSE fallback (`@bk/agent-core`)**

- `MCPServerConfig.url` — nuevo campo para conectar a servidores MCP remotos via HTTP; mutuamente excluyente con `command` (stdio), aunque si ambos están presentes `url` tiene prioridad
- `MCPServerConfig.headers` — HTTP headers enviados en cada request (e.g. `Authorization: Bearer tok_...`)
- `MCPServerConfig.remoteTransport` — fuerza un transporte específico: `'streamable-http'` (spec actual) o `'sse'` (servidores pre-2025); por defecto auto-detección
- `MCPClientManager.connectRemote()` — intenta `StreamableHTTPClientTransport` primero; si el servidor responde con HTTP 4xx cae automáticamente a `SSEClientTransport` sin configuración adicional
- `MCPClientManager.getServerInfo()` — devuelve `{ name, transportUsed, toolCount }` por servidor; expuesto públicamente para diagnósticos desde el REPL
- `AgentEngine.getMCPManager()` — getter público que expone el `MCPClientManager` del engine; permite inspeccionar conexiones y tools desde fuera del engine

**MCP wiring en `coding-assistant` + `/mcp` command**

- `BkAgentConfig.mcpServers` — nuevo campo en el config file (`~/.coding-assistant/config.json`); leído por `ConfigLoader` y forwarded automáticamente a `createCodingEngine` por `createCodingEngineFromConfig`
- `makeEngine()` — acepta `mcpServers?: MCPServerConfig[]` y los pasa al engine
- `/mcp list` — muestra servidores configurados con modo (stdio/remote) y estado de conexión (transport usado + tool count una vez inicializados)
- `/mcp tools` — inicializa las conexiones MCP y lista todas las tools descubiertas con nombre namespace (`mcp:{server}:{tool}`) y descripción
- Banner del coding-assistant — muestra nombres de servidores MCP activos en el panel izquierdo cuando hay servidores configurados
- `/mcp` agregado al panel de comandos del welcome screen

**Fix de imports en `@bk/mcp-server`**

- `tools/skills/list.ts` y `tools/skills/search.ts` — `GLOBAL_BUILTIN_SKILLS` y `NODE_PACK_SKILLS` movidos de `@bk/agent-core` a `@bk/agent-coding` (donde viven desde v0.5.0); imports actualizados
- `@bk/agent-coding` agregado como dependencia de `@bk/mcp-server`

### Changed

- `MCPServerConfig` — `command` ya no es requerido (era `string`, ahora `string | undefined`); el campo es opcional cuando se usa `url`
- `MCPClientManager.connectOne()` — despacha a `connectStdio()` o `connectRemote()` según la presencia de `url` vs `command`; lanza error descriptivo si ninguno está presente

---

## [0.7.0] — 2026-05-29

### Added

**Auto-aprendizaje cross-sprint (`@bk/agent-coding` + `@bk/agent-core`)**

- `OrchestrationOptions.reflection` — nueva opción en `createCodingEngine`; acepta `true` (defaults) o una instancia `ReflectionEngine` (control total sobre paths, `promotionThreshold`, `maxAutoGeneratedRules`)
- `ReflectionEngine.initialize()` corre en background al crear el engine; el factory `createCodingEngine` sigue siendo síncrono
- `AuditReflectionBridge.reportFindings()` ahora cierra el ciclo completo de reflexión:
  1. `AuditHook.reportFindings()` → `FailureCatalog` (persiste en `audits/failure-catalog.json`)
  2. `engine.flushReflections()` → `PatternDetector` detecta `failureType`s con ≥ `promotionThreshold` ocurrencias → `PolicyPromoter` escribe `manifest.yaml`
  3. `LessonsMemoGenerator.persist()` → `lecciones-aprendidas.md` con historial cross-sprint, tabla de reglas promovidas y checklist dinámico
- Las `ManifestPolicyRule` auto-generadas tienen `autoGenerated: true`; el `Orchestrator` las aplica desde el siguiente `run()` sin reiniciar

### Changed

- `AuditReflectionBridge` — almacena referencia directa al `ReflectionEngine` (antes solo tenía `AuditHook`); `disconnect()` limpia ambas referencias
- `AuditReflectionBridge.reportFindings()` — omite gates sin hallazgos antes del loop (optimización); ejecuta `flushReflections()` y `LessonsMemoGenerator.persist()` al finalizar si hay findings

---

## [0.6.0] — 2026-05-29

### Security

**API key file hardening (`@bk/agent-coding`)**
- `ConfigLoader._bootstrap()` — new `config.json` files are created with `chmod 600` (POSIX only); API keys are no longer world/group-readable by default
- `ConfigLoader.load()` — detects existing files with overly permissive modes and emits a `console.warn` with the corrective `chmod 600` command

**Secret detection in write paths (`@bk/agent-coding`)**
- `secret-scanner.ts` — new module with `scanForSecrets()` and `warnIfSecrets()`; 7 patterns: Anthropic/OpenAI/AWS/GitHub/GitLab API keys, private key blocks, generic `password`/`secret`/`apiKey` assignments
- `write_file` and `edit_file` tools call `warnIfSecrets()` before every write; detection is non-blocking (logs a warning, never rejects legitimate code examples)

**Provider resilience (`@bk/agent-coding`)**
- `AnthropicProvider` — exponential backoff retry (default 3 attempts, cap 16 s) on 429 / 5xx; mid-stream guard prevents retrying after content has already been emitted to the caller
- `OpenAICompatibleProvider` — same retry + mid-stream guard; `stream_options: { include_usage: true }` for real token counting

**Real token counting (`@bk/agent-coding`)**
- `AnthropicProvider` — reads `message_start.usage.input_tokens` and `message_delta.usage.output_tokens` from the stream; calls `onMetrics(input, output)` at end of stream
- `OpenAICompatibleProvider` — reads `chunk.usage` from the final stream chunk when `include_usage: true`; calls `onMetrics` accordingly

**Input size guard (`@bk/agent-core`)**
- `AgentEngine.run()` — rejects inputs exceeding 100 KB (`Buffer.byteLength`); emits `error` + `done` events and returns early without touching the LLM; prevents prompt-injection via oversized payloads

**Automatic audit trail (`@bk/agent-core`)**
- Every tool execution in `runLoop` and `runAgentInternal` appends one NDJSON line to `auditLog` path: `{ ts, session, agent, tool, input (≤200 chars), success, durationMs }`
- `AgentEngineOptions.auditLog?: string` — optional path; directory is created automatically
- `BaseEngineOptions.auditLog?: string` — forwarded through `createBaseEngine`
- `createCodingEngine` defaults to `{projectDir}/audits/tool-calls.ndjson` when persistence is enabled
- Writes are fire-and-forget (`appendFile` callback) — zero impact on tool execution latency

**Multi-system message handling (`@bk/agent-coding`)**
- `toAnthropicMessages()` — collapses all `role: 'system'` messages scattered across the conversation into a single `system` parameter (joined with `\n\n`); prevents API errors when multiple system messages were present

**StdoutTransport listener leak fix (`@bk/agent-core`)**
- `StdoutTransport` — singleton `readline.Interface`; `onInput()` reuses the existing interface instead of creating a new one on each call; `close()` disposes it and resets the singleton; eliminates listener accumulation on workspace switches

---

## [0.5.0] — 2026-05-29

### Added — Motor autonomo (`@bk/agent-core`)

**MCP Client**
- `MCPClientManager` — connects to external MCP servers via stdio transport; discovers and wraps their tools as `ToolDefinition`s namespaced as `mcp:{name}:{tool}`
- `createBaseEngine({ mcpServers })` — lazy-connects all configured servers on the first `run()` call; per-server timeout configurable via `timeoutMs`
- `MCPServerConfig` type exported from `@bk/agent-core`

**Typed Tools**
- `defineTool({ name, description, input, execute })` — creates a `ToolDefinition` from a Zod schema; JSON Schema for the LLM is auto-generated, args are validated at runtime before reaching the handler
- Re-exports `z` (Zod) so consumers share the same instance
- `TypedToolOptions<TInput>` generic interface

**Workflow Engine**
- `workflow(name)` fluent builder with `.step(id, agentRef, opts)` — compile-time duplicate-id and dependency-cycle detection
- `agent(id)` helper for step references
- `WorkflowRunner` — executes steps as a DAG; steps with no shared dependencies run in parallel (`Promise.all`); `requireApproval: true` pauses for `onApprovalRequired` callback before executing
- `engine.runWorkflow(def, opts?)` on `AgentEngine` — accepts `WorkflowBuilder` or `WorkflowDef`; outputs from completed steps forwarded as context to dependents
- `WorkflowResult`, `WorkflowStepResult` types; 5 new `AgentEvent` variants (`workflow_start`, `workflow_step_start`, `workflow_step_complete`, `workflow_approval_required`, `workflow_complete`)

**External Triggers**
- `createAutonomousAgent(opts)` — factory that wraps `createBaseEngine` + `TriggerManager`; accepts `goal`, `triggers`, `webhookPort`
- `ScheduleTriggerConfig` — cron-based via `node-cron` v4 with timezone support and expression validation at startup
- `WebhookTriggerConfig` — lightweight HTTP server (`node:http`) with HMAC-SHA256 signature verification (`X-Hub-Signature-256`); responds `202` immediately and runs the agent async
- `EventTriggerConfig` — process-wide `EventBus` (typed pub/sub); optional `source` filter
- `TriggerManager` — serializes concurrent fires: drops incoming triggers while agent is busy (v1 behavior)
- `EventBus` singleton exported for cross-agent and external event emission

**Observability**
- `ObservabilityManager` — wraps `Transport` transparently; no changes needed to existing engine or agents
- `Tracer` — lightweight span tracking for `run` and `agent_block` events; pluggable `SpanExporter` (`'console'` | `'noop'` | custom function)
- `MetricsCollector` — in-memory aggregation: run count, error rate, latency p50/p95/p99, token totals, per-tool call counts, per-agent invocation time; `getMetricsSnapshot()` accessor
- `CostTracker` — per-run and per-day USD budget enforcement; daily counter resets at UTC midnight via unref'd interval; fires `onBudgetExceeded(usage)` with `budgetExceeded: 'perRun' | 'perDay'`
- `createBaseEngine({ observability })` — wraps transport and passes `ObservabilityManager` to engine
- `engine.observability` getter on `AgentEngine`
- `MODEL_PRICING` presets for `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-4o`, `gpt-4o-mini`, `deepseek-chat`
- `onMetrics?(inputTokens, outputTokens)` added to `LLMStreamCallbacks` (optional, backward-compatible); engine emits `metrics` event when providers call it

**Advanced Memory System**
- `EpisodicMemory` — append-only log; `remember(content, tags)`, `recall(query, limit)` by keyword overlap, `recallByTag()`, `recallRecent(n)`; `maxEpisodes` retention with optional `SummarizeFn` compaction
- `SemanticMemory` — knowledge base with `index(content, metadata)` and `search(query)`; keyword scoring by default; switches to cosine similarity when `EmbedFn` injected (compatible with any embedding provider)
- `ProceduralMemory` — learned patterns from outcomes; `learnPattern(trigger, action, outcome)` deduplicates by `(trigger, action, outcome)` and increments occurrence count; `buildContextBlock()` formats as markdown
- `MemorySystem` — unified facade; `buildContextBlock(query)` combines all three tiers async; `getTools()` returns 5 `ToolDefinition`s built with `defineTool`
- `createMemorySystem(config)` factory
- Memory tools auto-registered when `createBaseEngine({ memorySystem })`: `memory_remember`, `memory_recall`, `memory_save_knowledge`, `memory_search_knowledge`, `memory_learn_pattern`
- `ExecutionContext.advancedMemory?` populated when memory system is configured
- `InMemoryStore` (no deps) and `JsonFileStore` (uses `atomicWriteSync`) backends; `MemoryStoreBackend` interface for custom backends

**Agent Discovery**
- `AgentPackageLoader` — scans `~/.{appName}/agents/` (global) and `{cwd}/.{appName}/agents/` (project) for `agent.yaml`, `agent.json`, or `{name}/agent.yaml` package-directory layouts
- `RemoteAgentRegistry` — fetches registry index from a remote URL; downloads and caches packages to disk; index TTL 1 hour; parallel installs with per-package error isolation
- `discoverAgents(config)` — composes local and remote sources, deduplicates by `id` (global → project → registry order)
- `createBaseEngine({ agentDiscovery })` — wires `discoverAgents` as lazy `loadAgents` callback
- `ensureAgentsLoaded()` on `AgentEngine` — called on first `run()` and `runWorkflow()`; falls back to first registered agent if `defaultAgent` isn't loaded yet
- `AgentProfile.source` extended with `'registry'` value
- `agent.yaml` format mirrors `AgentProfile` — zero new schema to learn

### Changed

- `AgentEngine.run()` — MCP init, agent loading, and memory context block are now all resolved via `ensure*()` helpers before the run loop, in consistent order
- `AgentEngine.runWorkflow()` — also calls `ensureMCPInitialized()` and `ensureAgentsLoaded()`
- `AgentEngine.buildSystemPrompt()` — injects memory context block after `projectContext` and before active skills
- Architecture diagram in README updated to include new modules

### Dependencies added (`@bk/agent-core`)

- `node-cron@^4.2.1` — schedule triggers
- `zod@^3.25.0` — typed tools
- `zod-to-json-schema@^3.24.0` — JSON Schema generation from Zod schemas
- `@modelcontextprotocol/sdk@^1.12.0` — MCP client (added in session prefix)

---

## [0.4.0] — 2026-05-29

### Added

- `createBaseEngine(opts)` in `@bk/agent-core` — minimal domain-agnostic engine factory; no coding-specific assumptions; foundation for any agent type
- `BaseEngineOptions` type exported from `@bk/agent-core`
- `Orchestrator` exposed via both `createCodingEngine()` and `createBaseEngine()` as optional `orchestrator` option

**Skill system wired to engine**
- `SkillLoader` + `SkillActivator` integrated in `createCodingEngine` — 33 builtin skills now reach the LLM on every run
- Activation by trigger + stack: only skills whose `triggers` match the input AND whose `language` matches the detected stack are injected — no prompt bloat
- Lazy-loading of YAML skills (global + packs + project) on first `run()` — `createCodingEngine` stays synchronous

**New language skill packs**
- `@bk-go` — 4 skills: `go-error-handling`, `go-concurrency`, `go-http-server`, `go-testing`
- `@bk-java` — 4 skills: `spring-layered-architecture`, `spring-exception-handling`, `spring-testing`, `spring-jpa`
- `@bk-kotlin` — 4 skills: `kotlin-coroutines`, `compose-patterns`, `android-architecture`, `kotlin-testing`
- `@bk-python` — 4 skills: `fastapi-patterns`, `python-error-handling`, `sqlalchemy-patterns`, `python-testing`
- Kotlin stack detection added: `build.gradle.kts` / `settings.gradle.kts` detected as `kotlin` (separate from `java`)

**Skills**
- Project skills moved inside the project directory (`{cwd}/.{appName}/skills/`) — git-tracked and team-shareable
- Builtin skill content moved from `@bk/agent-core` to `@bk/agent-coding`

### Changed

- Total builtin skills: 33 (5 global + 12 Node + 4 Go + 4 Java + 4 Kotlin + 4 Python)

---

## [0.3.0] — 2026-05-29

### Added

- `project-manager` as 10th builtin agent — dedicated coordinator for the `/init` workflow; orchestrates documentation generation in parallel phases
- Maturity modes for all agents (`Prototype` / `Beta` / `Production`) — agents adapt their requirements, thresholds, and gates based on project maturity
- Formal GO / NO-GO / NO-GO conditional verdicts on `security`, `qa-engineer`, and `infrastructure` agents, with remediation plans (Immediate / Short-term / Medium-term)
- Self-audit checklists on all specialized agents — executed before delivering each response
- Structured response formats on all agents — consistent output regardless of LLM or session
- Automatic project stack detection — `detectProjectStack()` checks indicator files at engine startup and injects detected stack into all agent system prompts (fallback when `AGENT.md` is absent)
- `projectContext` injected into all agents (not just the orchestrator)

### Changed

- Total agents: 10 (added `project-manager`)

---

## [0.2.0] — 2026-05-26 to 2026-05-29

### Added

**Slash command system**
- `SlashCommandRegistry` with `register()`, `dispatch()`, `isCommand()` — extensible command bus
- `registerBuiltinCommands()` — registers all 6 built-in commands at once
- `/help` — lists commands + invokes LLM for contextual project guidance (`runEngine` callback)
- `/agents` — lists all registered agents with source tags (`[PROJECT]`, `[GLOBAL]`)
- `/skills` — lists currently loaded skills
- `/status` — current agent and model
- `/checkpoint` — full checkpoint lifecycle (create named/unnamed, list grouped, load by inject)
- `/workspace` — full workspace CRUD (create, add, remove, switch, delete)

**Checkpoint system**
- Smart naming: `checkpoint-{feature}-{YYYY-MM-DD}-{HHmm}.md`
- Grouped list view: most recent per feature with version count
- Load via context injection (not session replacement)
- `session.md` auto-initialized on first engine run if absent

**Workspaces**
- Multi-project workspace: group repos that belong to the same system
- `buildWorkspaceContext()` — combines `contexto-proyecto.md` from all projects in a workspace
- `/workspace switch` changes `workingDir` for all file tools via `onCwdChange` callback
- `workspaces.json` stored under `~/.{appName}/`

**Infrastructure**
- `GlobalSeed` + `FrameworkConfig` — idempotent app initialization; bootstraps `~/.{appName}/` structure on first run
- QA orchestration system — automatic code review after high-risk responses; FSM gates
- `ReflectionEngine` — auto-learning system; pattern detection from session outcomes
- `ContextPipeline` — staged context assembly (instructions → project → manifest → lessons → session)
- MCP server: 7 tools (`stack_detect`, `skills_search`, `skills_install`, `skills_list`, `code_search`, `code_context`, `code_index`)

---

## [0.1.0] — 2026-05-25

### Added

**`@bk/agent-core` — initial scaffold**
- `AgentEngine` with `run()` loop: system prompt assembly, LLM call, tool dispatch, multi-iteration until no tool calls
- `DelegationBus` — parallel agent delegation up to `maxParallelAgents` via `@backendkit-labs/bulkhead`; `runParallel()` and `runSingle()`
- `AgentRegistry`, `ToolRegistry`, `ProviderRegistry` — in-memory registries
- `SessionMemory` — in-memory key-value store for session state
- `StdoutTransport`, `CallbackTransport` — transport abstraction; engine is display-agnostic
- `ask_agent` builtin tool — enables LLM-driven agent delegation

**`@bk/agent-coding` — coding agent layer**
- 9 specialized agents: `general`, `coder`, `backend`, `frontend`, `qa-engineer`, `security`, `architecture`, `infrastructure`, `data`
- `AgentLoader` — loads agents from `~/.{appName}/agents/` (global) and `{cwd}/.{appName}/agents/` (project); supports `.json`+`.md` pairs and `.md`-only prompt overrides
- 6 filesystem tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`, `run_command`
- 6 memory/context tools: `save_context`, `save_learning`, `save_user_preference`, `save_audit`, `get_latest_audit`, `list_audits`
- `ProjectStore` — persistent storage under `~/.{appName}/projects/{key}/`; `cwdToProjectKey()` unified across the framework
- `ConfigLoader` — loads `~/.{appName}/config.json` with env var overrides; bootstraps on first run
- `createCodingEngine()` and `createCodingEngineFromConfig()` factories
- `/init` workflow — detects `new` / `existing` / `hybrid` mode; generates `design.md`, `specification.md`, `security.md`, `roadmap.md`, `AGENT.md` via multi-agent parallel phases

**LLM Providers**
- `AnthropicProvider` — streaming, tool use, system message extraction
- `DeepSeekProvider` — OpenAI-compatible
- `OpenAICompatibleProvider` — base for OpenAI, Kimi, Grok

**Resilience**
- `@backendkit-labs/retry` — exponential backoff with jitter on all LLM calls
- `@backendkit-labs/circuit-breaker` — applied to LLM client; `ResilientLLMClient` wrapper
- `@backendkit-labs/bulkhead` — concurrency control on `DelegationBus`
- `@backendkit-labs/pipeline` — used in `Orchestrator` enrichment chain
- `@backendkit-labs/result` — Result monad in `ContextPipeline`

**Skill system**
- `SkillLoader` — 3-layer hierarchy: global (`~/.{appName}/skills/global/`), packs (`~/.{appName}/skills/packs/`), project
- `SkillActivator` — trigger + stack matching; `buildSystemPromptAddition()` for active skills
- `SkillManager` — `install()`, `uninstall()`, `list()`, `update()` with atomic all-or-nothing writes
- 17 builtin skills: 5 global + 12 Node/TypeScript (`@bk-node` pack)

**`@bk/mcp-server`**
- MCP server exposing 7 tools to Claude Code, Cursor, Windsurf and any MCP client
- Tree-sitter WASM indexer: TypeScript, JavaScript, Python, Go, Rust, Java
- SQLite FTS5 for fast symbol search
- Stack detection with 45 framework signatures

**`examples/coding-assistant`**
- Interactive REPL with readline, full slash command integration, streaming output

[Unreleased]: https://github.com/backendkit-dev/agent-framework/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/backendkit-dev/agent-framework/releases/tag/v0.1.0
