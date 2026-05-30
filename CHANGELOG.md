# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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

[Unreleased]: https://github.com/backendkit-dev/agent-framework/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/backendkit-dev/agent-framework/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/backendkit-dev/agent-framework/releases/tag/v0.1.0
